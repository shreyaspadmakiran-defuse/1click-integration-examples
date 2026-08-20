/**
 * An in-memory 1Click, for testing YOUR integration.
 *
 * WHY THIS EXISTS
 *   There is no testnet for NEAR Intents. The official guidance is to use
 *   small amounts on mainnet. That is fine for a handful of manual checks and
 *   useless for an automated test suite: you cannot write a CI test that
 *   spends real money, and you certainly cannot test the refund path or a
 *   5xx from the API by waiting for one to happen.
 *
 *   So test your own orchestration against this, and reserve real mainnet
 *   swaps for a final manual smoke test.
 *
 * WHAT IT IS FOR
 *   Your state machine, persistence, retry logic, status handling, refund
 *   handling, and error paths. It is deterministic and offline.
 *
 * WHAT IT IS NOT FOR
 *   Pricing accuracy, solver behavior, or signature verification. Mock quotes
 *   carry a placeholder signature that verifyQuote() will correctly REJECT,
 *   because this class has no access to 1Click's signing key. Do not "fix"
 *   that by disabling verification in production code; keep the check and
 *   inject a real recorded quote if you need to exercise it.
 *
 * It extends OneClickClient so it drops into any function typed against the
 * real client, including every flow in this repo.
 */
import { OneClickClient } from '../client/one-click-client';
import { ApiError } from '../client/http';
import { formatAmount } from '../utils/amounts';
import { ruleFor } from '../config/swap-rules';
import {
  AccountBalance,
  AccountHistoryEntry,
  AnyInputWithdrawalsResponse,
  AuthenticateResponse,
  ExecutionStatus,
  GenerateIntentResponse,
  QuoteRequest,
  QuoteResponse,
  RefreshResponse,
  SubmitDepositTxRequest,
  SubmitIntentResponse,
  SwapStatus,
  TokenInfo,
} from '../types/one-click';

/** A small, realistic token set. Override via options.tokens for other chains. */
export const MOCK_TOKENS: TokenInfo[] = [
  {
    assetId: 'nep141:wrap.near',
    decimals: 24,
    blockchain: 'near',
    symbol: 'wNEAR',
    price: 5,
    priceUpdatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    assetId: 'nep141:usdt.tether-token.near',
    decimals: 6,
    blockchain: 'near',
    symbol: 'USDT',
    price: 1,
    priceUpdatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    assetId: 'nep141:eth.omft.near',
    decimals: 18,
    blockchain: 'eth',
    symbol: 'ETH',
    price: 3000,
    priceUpdatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    // A memo chain, so you can test the depositMemo path you would otherwise
    // only discover in production.
    assetId: 'nep141:xlm.omft.near',
    decimals: 7,
    blockchain: 'stellar',
    symbol: 'XLM',
    price: 0.1,
    priceUpdatedAt: '2026-01-01T00:00:00.000Z',
  },
];

/** Chains where the mock issues a depositMemo, mirroring real memo chains. */
const MEMO_CHAINS = new Set(['stellar', 'xrp', 'ton', 'cosmos']);

export interface MockSwap {
  depositAddress: string;
  depositMemo?: string;
  request: QuoteRequest;
  quote: QuoteResponse;
  /** Remaining statuses to hand out, one per getStatus call */
  statusQueue: SwapStatus[];
  currentStatus: SwapStatus;
  intentHash?: string;
  txHash?: string;
}

export interface MockOneClickOptions {
  tokens?: TokenInfo[];
  /**
   * Status progression each swap walks through, one step per getStatus call.
   * The last entry repeats forever. Change it to test refunds and failures:
   *   ['PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT', 'REFUNDED']
   *   ['PENDING_DEPOSIT', 'PROCESSING', 'FAILED']
   */
  statusSequence?: SwapStatus[];
  /** Balances returned by getBalances, keyed by assetId */
  balances?: Record<string, string>;
  /** Deterministic id suffix so generated addresses are reproducible */
  seed?: number;
}

const DEFAULT_SEQUENCE: SwapStatus[] = ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'];

export class MockOneClickClient extends OneClickClient {
  private readonly tokens: TokenInfo[];
  private readonly statusSequence: SwapStatus[];
  private readonly balances: Record<string, string>;
  private counter: number;

  /** Every swap this mock has created, keyed by deposit address. */
  readonly swaps = new Map<string, MockSwap>();

  /** Calls made, so tests can assert on them. */
  readonly calls: string[] = [];

  /** Queued failures, consumed one per matching call. See failNext(). */
  private readonly failures: Array<{ method: string; error: unknown }> = [];

  constructor(options: MockOneClickOptions = {}) {
    super({ baseUrl: 'https://mock.invalid' }); // never used: every method is overridden
    this.tokens = options.tokens ?? MOCK_TOKENS;
    this.statusSequence = options.statusSequence ?? DEFAULT_SEQUENCE;
    this.balances = options.balances ?? {};
    this.counter = options.seed ?? 0;
  }

  /**
   * Make the next call to `method` throw. This is how you test error paths
   * that are impractical to trigger against the real API.
   *
   *   mock.failNext('submitIntent', new Error('The operation timed out'));
   *   mock.failNext('getQuote', new ApiError(url, 503, {}));
   */
  failNext(method: keyof OneClickClient, error?: unknown): void {
    this.failures.push({
      method: method as string,
      error: error ?? new ApiError('https://mock.invalid', 503, { message: 'mock failure' }),
    });
  }

  private record(method: string): void {
    this.calls.push(method);
    const index = this.failures.findIndex((failure) => failure.method === method);
    if (index >= 0) {
      const [failure] = this.failures.splice(index, 1);
      throw failure.error;
    }
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${String(this.counter).padStart(4, '0')}`;
  }

  private token(assetId: string): TokenInfo {
    const token = this.tokens.find((entry) => entry.assetId === assetId);
    if (!token) throw new ApiError('https://mock.invalid/v0/quote', 400, { message: `Unknown asset ${assetId}` });
    return token;
  }

  /** Price via the fixture USD prices, so results are deterministic. */
  private convert(amount: string, from: TokenInfo, to: TokenInfo): string {
    const scaled = (BigInt(amount) * BigInt(Math.round(from.price * 1e6))) / BigInt(Math.round(to.price * 1e6));
    const adjusted = (scaled * 10n ** BigInt(to.decimals)) / 10n ** BigInt(from.decimals);
    return adjusted.toString();
  }

  private applyBps(amount: string, bps: number): string {
    return ((BigInt(amount) * BigInt(10_000 - bps)) / 10_000n).toString();
  }

  /** The *Formatted fields are human units in the real API, so match that. */
  private format(amount: string, assetId: string): string {
    const token = this.tokens.find((entry) => entry.assetId === assetId);
    return token ? formatAmount(amount, token.decimals) : amount;
  }

  override async getTokens(): Promise<TokenInfo[]> {
    this.record('getTokens');
    return [...this.tokens];
  }

  override async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    this.record('getQuote');

    // Enforce the same matrix rules the real API does, so a test cannot
    // pass here and fail in production.
    const rule = ruleFor(request.swapType);
    if (!rule.depositTypes.includes(request.depositType)) {
      throw new ApiError('https://mock.invalid/v0/quote', 400, {
        message: `depositType ${request.depositType} not supported for ${request.swapType}`,
      });
    }
    if (Date.parse(request.deadline) <= Date.now()) {
      throw new ApiError('https://mock.invalid/v0/quote', 400, { message: 'deadline is in the past' });
    }

    const isAnyInput = request.swapType === 'ANY_INPUT';
    const origin = isAnyInput ? this.token('nep141:wrap.near') : this.token(request.originAsset);
    const destination = this.token(request.destinationAsset);

    // EXACT_OUTPUT sizes from the destination side; everything else from origin.
    let amountIn: string;
    let amountOut: string;
    if (request.swapType === 'EXACT_OUTPUT') {
      amountOut = request.amount;
      amountIn = this.convert(request.amount, destination, origin);
    } else {
      amountIn = request.amount;
      amountOut = this.convert(request.amount, origin, destination);
    }

    const slippage = request.slippageTolerance;
    const quote: QuoteResponse = {
      correlationId: this.nextId('corr'),
      timestamp: new Date().toISOString(),
      // Deliberately not a real signature. verifyQuote() will reject this.
      signature: 'ed25519:MOCK_SIGNATURE_NOT_VERIFIABLE',
      quoteRequest: request,
      quote: {
        depositAddress: request.dry ? undefined : this.nextId('mock-deposit'),
        depositMemo:
          !request.dry && MEMO_CHAINS.has(origin.blockchain) && request.depositType === 'ORIGIN_CHAIN'
            ? this.nextId('memo')
            : undefined,
        amountIn,
        amountInFormatted: this.format(amountIn, origin.assetId),
        amountInUsd: '0',
        // EXACT_OUTPUT slips the input; the others slip the output.
        minAmountIn: request.swapType === 'EXACT_INPUT' ? amountIn : this.applyBps(amountIn, slippage),
        amountOut,
        amountOutFormatted: this.format(amountOut, destination.assetId),
        amountOutUsd: '0',
        minAmountOut: request.swapType === 'EXACT_OUTPUT' ? amountOut : this.applyBps(amountOut, slippage),
        deadline: request.deadline,
        timeEstimate: 30,
      },
    };

    if (!request.dry && quote.quote.depositAddress) {
      this.swaps.set(quote.quote.depositAddress, {
        depositAddress: quote.quote.depositAddress,
        depositMemo: quote.quote.depositMemo,
        request,
        quote,
        statusQueue: [...this.statusSequence],
        currentStatus: this.statusSequence[0],
      });
    }
    return quote;
  }

  override async getStatus(depositAddress: string, depositMemo?: string): Promise<ExecutionStatus> {
    this.record('getStatus');

    const swap = this.swaps.get(depositAddress);
    if (!swap) {
      throw new ApiError('https://mock.invalid/v0/status', 404, {
        message: `Deposit address ${depositAddress} not found`,
      });
    }
    // Reproduce the memo-chain 404 that surprises people in production.
    if (swap.depositMemo && depositMemo !== swap.depositMemo) {
      throw new ApiError('https://mock.invalid/v0/status', 404, {
        message: 'Deposit address not found (this swap requires depositMemo)',
      });
    }

    // Advance one step per call; the final status sticks.
    if (swap.statusQueue.length > 1) swap.statusQueue.shift();
    swap.currentStatus = swap.statusQueue[0];

    const terminalSuccess = swap.currentStatus === 'SUCCESS';
    const refunded = swap.currentStatus === 'REFUNDED';

    // Nothing has arrived yet in PENDING_DEPOSIT, and only PART of it has in
    // INCOMPLETE_DEPOSIT. Reporting the full amount in either state would let
    // a "did they underpay?" check pass in tests and fail in production.
    const quoted = swap.quote.quote.amountIn;
    let received: string | undefined;
    if (swap.currentStatus === 'PENDING_DEPOSIT') {
      received = undefined;
    } else if (swap.currentStatus === 'INCOMPLETE_DEPOSIT') {
      received = ((BigInt(quoted) * 40n) / 100n).toString(); // 40% short
    } else {
      received = quoted;
    }

    const origin = swap.request.originAsset;
    const destination = swap.request.destinationAsset;
    return {
      correlationId: swap.quote.correlationId,
      quoteResponse: swap.quote,
      status: swap.currentStatus,
      updatedAt: new Date().toISOString(),
      swapDetails: {
        intentHashes: swap.intentHash ? [swap.intentHash] : [],
        nearTxHashes: [],
        amountIn: received,
        amountInFormatted: received === undefined ? undefined : this.format(received, origin),
        amountOut: terminalSuccess ? swap.quote.quote.amountOut : undefined,
        amountOutFormatted: terminalSuccess ? this.format(swap.quote.quote.amountOut, destination) : undefined,
        refundedAmount: refunded ? received : undefined,
        refundedAmountFormatted: refunded && received !== undefined ? this.format(received, origin) : undefined,
        originChainTxHashes: swap.txHash ? [{ hash: swap.txHash }] : [],
        destinationChainTxHashes: [],
      },
    };
  }

  override async submitDepositTx(request: SubmitDepositTxRequest): Promise<ExecutionStatus> {
    this.record('submitDepositTx');
    const swap = this.swaps.get(request.depositAddress);
    if (!swap) {
      throw new ApiError('https://mock.invalid/v0/deposit/submit', 404, { message: 'Deposit address not found' });
    }
    swap.txHash = request.txHash;
    return this.getStatus(request.depositAddress, request.memo);
  }

  override async generateIntent(): Promise<GenerateIntentResponse> {
    this.record('generateIntent');
    return {
      intent: {
        standard: 'nep413',
        payload: { recipient: 'intents.near', nonce: this.nextId('nonce'), message: '{"intents":[]}' },
      },
      correlationId: this.nextId('corr'),
    };
  }

  override async submitIntent(): Promise<SubmitIntentResponse> {
    this.record('submitIntent');
    const intentHash = this.nextId('intent');
    // Attach to the most recent swap so status reflects the submission.
    const latest = [...this.swaps.values()].pop();
    if (latest) latest.intentHash = intentHash;
    return { intentHash, correlationId: latest?.quote.correlationId ?? this.nextId('corr') };
  }

  override async authenticate(): Promise<AuthenticateResponse> {
    this.record('authenticate');
    return {
      accessToken: this.nextId('access'),
      refreshToken: this.nextId('refresh'),
      expiresIn: 3600,
      refreshExpiresIn: 86_400,
    };
  }

  override async refresh(): Promise<RefreshResponse> {
    this.record('refresh');
    return { accessToken: this.nextId('access'), expiresIn: 3600 };
  }

  override async getBalances(): Promise<AccountBalance[]> {
    this.record('getBalances');
    return Object.entries(this.balances).map(([assetId, balance]) => ({ assetId, balance }));
  }

  override async getHistory(): Promise<AccountHistoryEntry[]> {
    this.record('getHistory');
    return [...this.swaps.values()].map((swap) => ({
      depositAddress: swap.depositAddress,
      status: swap.currentStatus,
      originAsset: swap.request.originAsset,
      destinationAsset: swap.request.destinationAsset,
      amountIn: swap.quote.quote.amountIn,
      amountOut: swap.quote.quote.amountOut,
      createdAt: swap.quote.timestamp,
    }));
  }

  override async getAnyInputWithdrawals(): Promise<AnyInputWithdrawalsResponse> {
    this.record('getAnyInputWithdrawals');
    return { withdrawals: [], page: 1, limit: 50, total: 0 };
  }
}
