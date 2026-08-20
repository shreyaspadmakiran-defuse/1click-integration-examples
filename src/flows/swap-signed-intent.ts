import { OneClickClient } from '../client/one-click-client';
import { quoteRequestErrors, ruleFor } from '../config/swap-rules';
import {
  ExecutionStatus,
  QuoteRequest,
  QuoteResponse,
  SignedIntentData,
  SigningStandard,
  UnsignedIntent,
} from '../types/one-click';
import { logger } from '../utils/logger';
import { verifyQuote } from '../utils/verify-quote';
import { pollUntilSettled, PollOptions } from './poll-status';
import { submitIntentSafely } from './submit-intent-safely';

/**
 * Your wallet integration: receives the unsigned intent payload exactly as
 * returned by /v0/generate-intent and must return the signature fields.
 * Do not modify the payload; the signature must cover it byte for byte.
 */
export type IntentSigner = (intent: UnsignedIntent) => Promise<{ publicKey?: string; signature: string }>;

export interface SignedIntentSwapResult {
  quote: QuoteResponse;
  intentHash: string;
  status: ExecutionStatus;
}

/**
 * INTENTS / CONFIDENTIAL_INTENTS flow:
 * funds already sit inside NEAR Intents, so instead of an on-chain deposit
 * the user authorizes the swap by signing an intent message off-chain.
 *
 * 1. POST /v0/quote (dry=false, depositType INTENTS or CONFIDENTIAL_INTENTS)
 * 2. POST /v0/generate-intent with the quote's depositAddress
 * 3. The user's wallet signs the payload (your IntentSigner callback)
 * 4. POST /v0/submit-intent with the signed MultiPayload
 * 5. Poll GET /v0/status until settled
 *
 * Requires partner auth: construct OneClickClient with apiKey set.
 */
export async function executeSignedIntentSwap(
  client: OneClickClient,
  request: Omit<QuoteRequest, 'dry'>,
  signer: IntentSigner,
  options: { signerId: string; standard: SigningStandard } & PollOptions,
): Promise<SignedIntentSwapResult> {
  if (request.depositType === 'ORIGIN_CHAIN') {
    throw new Error('Signed intent execution requires depositType INTENTS or CONFIDENTIAL_INTENTS');
  }

  const quoteRequest: QuoteRequest = { ...request, dry: false };
  const errors = quoteRequestErrors(quoteRequest);
  if (errors.length > 0) {
    throw new Error(`Invalid ${request.swapType} request: ${errors.join('; ')}`);
  }

  const quote = await client.getQuote(quoteRequest);
  if (!verifyQuote(quote)) {
    throw new Error('Quote signature verification failed, refusing to continue');
  }
  const depositAddress = quote.quote.depositAddress;
  if (!depositAddress) {
    throw new Error('Quote response did not include a depositAddress');
  }

  const generated = await client.generateIntent({
    type: 'swap_transfer',
    standard: options.standard,
    signerId: options.signerId,
    depositAddress,
  });
  logger.info(`Generated intent for quote ${quote.correlationId}, awaiting signature`);

  const { publicKey, signature } = await signer(generated.intent);
  const signedData: SignedIntentData = {
    ...generated.intent,
    ...(publicKey ? { public_key: publicKey } : {}),
    signature,
  };

  const submitted = await submitIntentSafely(client, { type: 'swap_transfer', signedData }, depositAddress, {
    depositMemo: quote.quote.depositMemo,
  });
  logger.info(
    `Submitted intent ${submitted.intentHash}${submitted.recovered ? ' (recovered from earlier attempt)' : ''}`,
  );

  // ANY_INPUT deposits accumulate and are swept on a threshold, so there is
  // no terminal status to wait for. Polling would just burn the timeout.
  if (!ruleFor(request.swapType).settlesToTerminalStatus) {
    logger.warn(
      `${request.swapType} has no terminal status: deposits are swept periodically. ` +
        `Reconcile with getAnyInputWithdrawals({ depositAddress: "${depositAddress}" }) instead of polling.`,
    );
    const status = await client.getStatus(depositAddress, quote.quote.depositMemo);
    return { quote, intentHash: submitted.intentHash, status };
  }

  const status = await pollUntilSettled(client, depositAddress, {
    depositMemo: quote.quote.depositMemo,
    ...options,
  });
  return { quote, intentHash: submitted.intentHash, status };
}
