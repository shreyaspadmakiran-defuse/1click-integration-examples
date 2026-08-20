import { OneClickClient } from '../client/one-click-client';
import { quoteGuarantees, quoteRequestErrors } from '../config/swap-rules';
import { ExecutionStatus, QuoteRequest, QuoteResponse } from '../types/one-click';
import { logger } from '../utils/logger';
import { verifyQuote } from '../utils/verify-quote';
import { pollUntilSettled, PollOptions } from './poll-status';

export interface OriginChainSwapHandle {
  quote: QuoteResponse;
  depositAddress: string;
  depositMemo?: string;
  /**
   * Call after you have broadcast the deposit on the origin chain.
   * Optionally submits the tx hash to speed up detection, then polls
   * until the swap settles.
   */
  settle: (options?: { txHash?: string; nearSenderAccount?: string } & PollOptions) => Promise<ExecutionStatus>;
}

/**
 * ORIGIN_CHAIN flow:
 * 1. POST /v0/quote with dry=false to get a depositAddress
 * 2. You send the deposit on the origin chain (this library never holds keys)
 * 3. Optionally POST /v0/deposit/submit with the tx hash
 * 4. Poll GET /v0/status until SUCCESS, REFUNDED, or FAILED
 *
 * The function stops after step 1 and hands back a settle() callback,
 * because step 2 belongs to your wallet or signer infrastructure.
 */
export async function startOriginChainSwap(
  client: OneClickClient,
  request: Omit<QuoteRequest, 'dry' | 'depositType'>,
): Promise<OriginChainSwapHandle> {
  const quoteRequest: QuoteRequest = { ...request, dry: false, depositType: 'ORIGIN_CHAIN' };

  // Validate before dry=false: this call allocates a real deposit address.
  const errors = quoteRequestErrors(quoteRequest);
  if (errors.length > 0) {
    throw new Error(`Invalid ${request.swapType} request: ${errors.join('; ')}`);
  }

  const quote = await client.getQuote(quoteRequest);

  if (!verifyQuote(quote)) {
    throw new Error('Quote signature verification failed, refusing to use the deposit address');
  }
  const depositAddress = quote.quote.depositAddress;
  if (!depositAddress) {
    throw new Error('Quote response did not include a depositAddress');
  }

  // amountIn is the right instruction for EXACT_INPUT only. For EXACT_OUTPUT
  // and FLEX_INPUT the number that decides refund-versus-swap is minAmountIn.
  const guarantees = quoteGuarantees(quote);
  logger.info(
    `Quote ${quote.correlationId} (${guarantees.swapType}): send ${quote.quote.amountInFormatted} ` +
      `of ${request.originAsset} to ${depositAddress}` +
      (quote.quote.depositMemo ? ` with memo ${quote.quote.depositMemo}` : '') +
      ` before ${quote.quote.deadline}. ` +
      `Anything below ${guarantees.fundAtLeast} (smallest units) is refunded to ${request.refundTo}.`,
  );

  return {
    quote,
    depositAddress,
    depositMemo: quote.quote.depositMemo,
    settle: async (options = {}) => {
      const { txHash, nearSenderAccount, ...pollOptions } = options;
      if (txHash) {
        await client.submitDepositTx({
          depositAddress,
          txHash,
          nearSenderAccount,
          memo: quote.quote.depositMemo,
        });
        logger.info(`Submitted deposit tx ${txHash} for ${depositAddress}`);
      }
      return pollUntilSettled(client, depositAddress, { depositMemo: quote.quote.depositMemo, ...pollOptions });
    },
  };
}
