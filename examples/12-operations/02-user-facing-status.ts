/**
 * What to SHOW a user at each status, and what to do about it.
 *
 * The API gives you seven statuses. Your users need something else: a clear
 * statement of what is happening, whether they must act, and whether it is
 * over. This mapping is the part every integration writes.
 *
 * COMMON MISTAKES
 *   1. Treating "terminal" as "successful". REFUNDED and FAILED are both
 *      terminal. Code that does `if (terminal) markFulfilled()` credits users
 *      for swaps that returned their money.
 *   2. Showing raw status strings. "INCOMPLETE_DEPOSIT" tells a user nothing;
 *      "You sent 0.4 of the 1.0 needed" tells them what to do.
 *   3. No action for actionable states. INCOMPLETE_DEPOSIT is the one status
 *      the user can fix, and only before the deadline.
 *
 * This takes a real dry quote from the live API, then renders it at each
 * status, so you can read every message without waiting for a real swap to
 * pass through them.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/12-operations/02-user-facing-status.ts
 */
import {
  ExecutionStatus,
  OneClickClient,
  QuoteResponse,
  SwapStatus,
  TERMINAL_STATUSES,
  formatAmount,
  parseAmount,
} from '../../src';

interface UserFacing {
  /** Short line for the user */
  headline: string;
  /** What is happening, in plain language */
  detail: string;
  /** Does the user need to do something? */
  actionRequired: boolean;
  /** Is this over? */
  terminal: boolean;
  /** Did the user get what they wanted? Distinct from terminal. */
  fulfilled: boolean;
  /** Should you keep polling? */
  keepWatching: boolean;
}

/** Renders smallest units as human units. Users must never see raw amounts. */
type Format = (raw: string | undefined, assetId: string) => string;

/**
 * The mapping. fulfilled is a SEPARATE flag from terminal, and that is what
 * stops you crediting a refunded swap.
 */
function toUserFacing(status: ExecutionStatus, format: Format): UserFacing {
  const quote = status.quoteResponse?.quote;
  const request = status.quoteResponse?.quoteRequest;
  const terminal = TERMINAL_STATUSES.includes(status.status);

  switch (status.status) {
    case 'PENDING_DEPOSIT':
      return {
        headline: 'Waiting for your payment',
        detail: `Send ${format(quote?.amountIn, request?.originAsset ?? '')} to the address shown${
          quote?.depositMemo ? `, including memo ${quote.depositMemo}` : ''
        }. This expires ${quote?.deadline ?? request?.deadline}.`,
        actionRequired: true,
        terminal: false,
        fulfilled: false,
        keepWatching: true,
      };

    case 'INCOMPLETE_DEPOSIT': {
      // The floor is minAmountIn for every swap type except EXACT_INPUT.
      const floor = request?.swapType === 'EXACT_INPUT' ? quote?.amountIn : quote?.minAmountIn;
      const received = status.swapDetails?.amountIn ?? '0';
      const asset = request?.originAsset ?? '';
      const short = floor ? (BigInt(floor) - BigInt(received)).toString() : undefined;
      return {
        headline: 'Not quite enough received',
        detail: `We received ${format(received, asset)} but need ${format(floor, asset)}. Send ${format(
          short,
          asset,
        )} more before ${quote?.deadline ?? request?.deadline} or it will be refunded.`,
        actionRequired: true,
        terminal: false,
        fulfilled: false,
        keepWatching: true,
      };
    }

    case 'KNOWN_DEPOSIT_TX':
      return {
        headline: 'Payment received',
        detail: 'We can see your transaction and are confirming it now.',
        actionRequired: false,
        terminal: false,
        fulfilled: false,
        keepWatching: true,
      };

    case 'PROCESSING':
      return {
        headline: 'Swapping now',
        detail: `Converting to ${
          request?.destinationAsset ?? 'your asset'
        }. Cross-chain swaps can take up to 15 minutes.`,
        actionRequired: false,
        terminal: false,
        fulfilled: false,
        keepWatching: true,
      };

    case 'SUCCESS':
      return {
        headline: 'Done',
        detail: `${format(status.swapDetails?.amountOut, request?.destinationAsset ?? '')} sent to ${
          request?.recipient ?? 'you'
        }.`,
        actionRequired: false,
        terminal: true,
        fulfilled: true, // the only status where this is true
        keepWatching: false,
      };

    case 'REFUNDED':
      return {
        headline: 'Refunded',
        detail: `The swap could not complete, so ${format(
          status.swapDetails?.refundedAmount,
          request?.originAsset ?? '',
        )} went back to ${
          request?.refundTo ?? 'your refund address'
        }. Usually the deposit was short or arrived after the deadline.`,
        actionRequired: false,
        terminal: true,
        fulfilled: false, // terminal, but the user did NOT get what they wanted
        keepWatching: false,
      };

    case 'FAILED':
      return {
        headline: 'Something went wrong',
        detail: `This swap failed. Reference ${status.correlationId} if you contact support.`,
        actionRequired: false,
        terminal: true,
        fulfilled: false,
        keepWatching: false,
      };

    default:
      return {
        headline: 'In progress',
        detail: `Unrecognized status ${status.status}. Keep watching rather than assuming an outcome.`,
        actionRequired: false,
        terminal,
        fulfilled: false,
        keepWatching: !terminal,
      };
  }
}

/**
 * Builds the ExecutionStatus your code would receive at a given status, given
 * how much has actually arrived so far. Only the fields /v0/status populates
 * at that stage are filled in.
 */
function statusAt(quote: QuoteResponse, status: SwapStatus, received: string | undefined): ExecutionStatus {
  return {
    correlationId: quote.correlationId,
    quoteResponse: quote,
    status,
    updatedAt: new Date().toISOString(),
    swapDetails: {
      intentHashes: [],
      nearTxHashes: [],
      amountIn: received,
      amountOut: status === 'SUCCESS' ? quote.quote.amountOut : undefined,
      refundedAmount: status === 'REFUNDED' ? received : undefined,
    },
  };
}

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  const usdt = tokens.find((t) => t.assetId === 'nep141:usdt.tether-token.near');
  if (!wnear || !usdt) throw new Error('Expected assets not listed');

  // A real dry quote, so the amounts and deadline below are genuine.
  const quote = await client.getQuote({
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: wnear.assetId,
    depositType: 'ORIGIN_CHAIN',
    amount: parseAmount('1', wnear.decimals),
    destinationAsset: usdt.assetId,
    recipient: 'example.near',
    recipientType: 'INTENTS',
    refundTo: 'example.near',
    refundType: 'ORIGIN_CHAIN',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  });

  // Build this once from GET /v0/tokens and reuse it across your app.
  const format: Format = (raw, assetId) => {
    if (raw === undefined) return 'the quoted amount';
    const token = tokens.find((entry) => entry.assetId === assetId);
    return token ? `${formatAmount(raw, token.decimals)} ${token.symbol}` : raw;
  };

  const paths: Array<[string, SwapStatus[]]> = [
    ['Happy path', ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS']],
    ['Underfunded, then refunded', ['PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT', 'REFUNDED']],
    ['Failure', ['PENDING_DEPOSIT', 'PROCESSING', 'FAILED']],
  ];

  for (const [label, sequence] of paths) {
    console.log(`\n${'='.repeat(76)}\n${label}\n${'='.repeat(76)}`);

    // Track what has actually arrived as the swap progresses, because a
    // refund returns the amount RECEIVED, not the amount quoted.
    const partial = ((BigInt(quote.quote.amountIn) * 40n) / 100n).toString();
    let received: string | undefined;

    for (const swapStatus of sequence) {
      if (swapStatus === 'PENDING_DEPOSIT') received = undefined;
      else if (swapStatus === 'INCOMPLETE_DEPOSIT') received = partial;
      else received ??= quote.quote.amountIn;

      const view = toUserFacing(statusAt(quote, swapStatus, received), format);

      console.log(`\n[${swapStatus}]`);
      console.log(`  "${view.headline}"`);
      console.log(`  ${view.detail}`);
      console.log(
        `  actionRequired=${view.actionRequired}  terminal=${view.terminal}  fulfilled=${view.fulfilled}  keepWatching=${view.keepWatching}`,
      );

      // The check that matters: fulfilled, not terminal.
      if (view.terminal) {
        console.log(view.fulfilled ? '  -> credit the user' : '  -> do NOT credit the user');
      }
    }
  }

  console.log(`\n${'='.repeat(76)}`);
  console.log('TERMINAL IS NOT FULFILLED');
  console.log('='.repeat(76));
  console.log('  terminal  means "stop polling"');
  console.log('  fulfilled means "the user got their funds"');
  console.log('\n  Only SUCCESS is fulfilled. REFUNDED and FAILED are terminal and not fulfilled.');
  console.log('  if (terminal) credit()    credits refunded swaps');
  console.log('  if (fulfilled) credit()   correct');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
