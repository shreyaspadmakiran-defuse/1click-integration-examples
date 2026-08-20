/**
 * What to SHOW a user at each status, and what to do about it.
 *
 * The API gives you seven statuses. Your users need something else: a clear
 * statement of what is happening, whether they must act, and whether it is
 * over. This mapping is the part every integration writes and the docs do not
 * cover.
 *
 * COMMON MISTAKES
 *   1. Treating "terminal" as "successful". REFUNDED and FAILED are both
 *      terminal. If your code does `if (terminal) markFulfilled()`, you will
 *      credit users for swaps that returned their money.
 *   2. Showing raw status strings. "INCOMPLETE_DEPOSIT" tells a user nothing
 *      and worries them; "You sent 0.4 of the 1.0 needed" tells them what to do.
 *   3. No action for actionable states. INCOMPLETE_DEPOSIT is the one status
 *      the user can actually fix, and only before the deadline.
 *
 * AUTH  none. Runs against the mock so every status is demonstrable.
 * RUN   npx ts-node examples/12-operations/02-user-facing-status.ts
 */
import {
  ExecutionStatus,
  MockOneClickClient,
  QuoteRequest,
  SwapStatus,
  TERMINAL_STATUSES,
  formatAmount,
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
 * The mapping. Note fulfilled is a SEPARATE flag from terminal: that
 * distinction is what stops you crediting a refunded swap.
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
        }. This expires ${quote?.deadline ?? 'shortly'}.`,
        actionRequired: true,
        terminal: false,
        fulfilled: false,
        keepWatching: true,
      };

    case 'INCOMPLETE_DEPOSIT': {
      // The one state the user can fix, and only before the deadline.
      // The floor is minAmountIn for every type except EXACT_INPUT.
      const floor = request?.swapType === 'EXACT_INPUT' ? quote?.amountIn : quote?.minAmountIn;
      const received = status.swapDetails?.amountIn ?? '0';
      const asset = request?.originAsset ?? '';
      const short = floor ? (BigInt(floor) - BigInt(received)).toString() : undefined;
      return {
        headline: 'Not quite enough received',
        detail: `We received ${format(received, asset)} but need ${format(floor, asset)}. Send ${format(
          short,
          asset,
        )} more before ${quote?.deadline} or it will be refunded.`,
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

const request: QuoteRequest = {
  dry: true,
  swapType: 'EXACT_INPUT',
  slippageTolerance: 100,
  originAsset: 'nep141:wrap.near',
  depositType: 'ORIGIN_CHAIN',
  amount: '1000000000000000000000000',
  destinationAsset: 'nep141:usdt.tether-token.near',
  recipient: 'example.near',
  recipientType: 'INTENTS',
  refundTo: 'example.near',
  refundType: 'ORIGIN_CHAIN',
  deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
};

/** Drive the mock through one full sequence and render each step. */
async function walk(label: string, sequence: SwapStatus[]): Promise<void> {
  console.log(`\n${'='.repeat(76)}\n${label}\n${'='.repeat(76)}`);

  const client = new MockOneClickClient({ statusSequence: sequence });

  // A real integration builds this once from GET /v0/tokens and reuses it.
  const tokens = await client.getTokens();
  const format: Format = (raw, assetId) => {
    if (raw === undefined) return 'the quoted amount';
    const token = tokens.find((entry) => entry.assetId === assetId);
    return token ? `${formatAmount(raw, token.decimals)} ${token.symbol}` : raw;
  };

  const quote = await client.getQuote({ ...request, dry: false });
  const address = quote.quote.depositAddress as string;

  for (let step = 0; step < sequence.length; step++) {
    const status = await client.getStatus(address);
    const view = toUserFacing(status, format);

    console.log(`\n[${status.status}]`);
    console.log(`  "${view.headline}"`);
    console.log(`  ${view.detail}`);
    console.log(
      `  actionRequired=${view.actionRequired}  terminal=${view.terminal}  fulfilled=${view.fulfilled}  keepWatching=${view.keepWatching}`,
    );

    // The check that matters. Note fulfilled, not terminal.
    if (view.terminal) {
      console.log(view.fulfilled ? '  -> credit the user' : '  -> do NOT credit the user');
      break;
    }
  }
}

async function main(): Promise<void> {
  await walk('Happy path', ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS']);
  await walk('Underfunded, then refunded', ['PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT', 'REFUNDED']);
  await walk('Failure', ['PENDING_DEPOSIT', 'PROCESSING', 'FAILED']);

  console.log(`\n${'='.repeat(76)}`);
  console.log('TERMINAL IS NOT FULFILLED');
  console.log('='.repeat(76));
  console.log('  terminal  means "stop polling"');
  console.log('  fulfilled means "the user got their funds"');
  console.log('\n  Only SUCCESS is fulfilled. REFUNDED and FAILED are terminal and NOT fulfilled.');
  console.log('  if (terminal) credit()          <- credits refunded swaps. Wrong.');
  console.log('  if (fulfilled) credit()         <- correct.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
