/**
 * The swap-type matrix, as data.
 *
 * swapType changes which token `amount` is denominated in, which depositTypes
 * are legal, which quote field tells you how much to actually send, and
 * whether the swap ever reaches a terminal status. Encoding that here rather
 * than in prose means the flows, the CLI, and the tests read the same rules.
 *
 * Source: https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types
 */
import { DepositType, QuoteRequest, QuoteResponse, SwapType } from '../types/one-click';

/** Which token the `amount` field of a quote request is denominated in. */
export type AmountUnit = 'ORIGIN' | 'DESTINATION' | 'IGNORED';

export interface SwapTypeRule {
  /**
   * Whose decimals convert a human amount into `amount`.
   * Getting this wrong is silent: 10 USDT (6 decimals) encoded with wNEAR's
   * 24 decimals is off by a factor of 10^18 and still a valid request.
   */
  amountUnit: AmountUnit;
  /** depositTypes the API accepts for this swap type */
  depositTypes: DepositType[];
  /** originAsset is fixed for this swap type (ANY_INPUT collects any token) */
  requiredOriginAsset?: string;
  /** `amount` must be exactly this value */
  requiredAmount?: string;
  /** The quote field a payer must reach or the deposit is refunded */
  fundingFloor?: 'amountIn' | 'minAmountIn';
  /** The quote field that bounds the payout, absent when priced at sweep time */
  payoutFloor?: 'amountOut' | 'minAmountOut';
  /** false when the swap never reaches SUCCESS/REFUNDED/FAILED */
  settlesToTerminalStatus: boolean;
  /** false when an underfunded or failed swap is retried rather than refunded */
  refundable: boolean;
  summary: string;
}

const RULES = {
  EXACT_INPUT: {
    amountUnit: 'ORIGIN',
    depositTypes: ['ORIGIN_CHAIN', 'INTENTS', 'CONFIDENTIAL_INTENTS'],
    fundingFloor: 'amountIn',
    payoutFloor: 'minAmountOut',
    settlesToTerminalStatus: true,
    refundable: true,
    summary: 'You fix what you send. Deposit below amountIn is refunded, above it swaps and the excess is refunded.',
  },
  EXACT_OUTPUT: {
    amountUnit: 'DESTINATION',
    depositTypes: ['ORIGIN_CHAIN', 'INTENTS', 'CONFIDENTIAL_INTENTS'],
    fundingFloor: 'minAmountIn',
    payoutFloor: 'amountOut',
    settlesToTerminalStatus: true,
    refundable: true,
    summary: 'You fix what you receive. `amount` is in destination units, and minAmountIn is the refund threshold.',
  },
  FLEX_INPUT: {
    amountUnit: 'ORIGIN',
    depositTypes: ['ORIGIN_CHAIN', 'INTENTS', 'CONFIDENTIAL_INTENTS'],
    fundingFloor: 'minAmountIn',
    payoutFloor: 'minAmountOut',
    settlesToTerminalStatus: true,
    refundable: true,
    summary: 'Deposit anywhere in a band around amountIn. Anything at or above minAmountIn swaps.',
  },
  ANY_INPUT: {
    amountUnit: 'IGNORED',
    // No on-chain deposit address: funds must already be inside Intents.
    depositTypes: ['INTENTS', 'CONFIDENTIAL_INTENTS'],
    requiredOriginAsset: '1cs_v1:any',
    requiredAmount: '0',
    settlesToTerminalStatus: false,
    refundable: false,
    summary:
      'A collection address that accepts any token. Deposits accumulate and are swept periodically, ' +
      'so there is no fixed rate and no terminal status. Reconcile with GET /v0/any-input/withdrawals.',
  },
} as const satisfies Record<SwapType, SwapTypeRule>;

/**
 * Widened on purpose: the `as const` above catches authoring mistakes, but
 * consumers need the shared shape so that optional fields and depositTypes
 * are reachable on every entry.
 */
export const SWAP_TYPE_RULES: Record<SwapType, SwapTypeRule> = RULES;

export function ruleFor(swapType: SwapType): SwapTypeRule {
  const rule = SWAP_TYPE_RULES[swapType];
  if (!rule) {
    throw new Error(`Unknown swapType "${swapType}", expected one of ${Object.keys(SWAP_TYPE_RULES).join(', ')}`);
  }
  return rule;
}

/**
 * The assetId whose decimals convert a human amount into `amount`.
 * undefined for ANY_INPUT, where `amount` carries no value.
 */
export function amountAssetId(
  request: Pick<QuoteRequest, 'swapType' | 'originAsset' | 'destinationAsset'>,
): string | undefined {
  const { amountUnit } = ruleFor(request.swapType);
  if (amountUnit === 'ORIGIN') return request.originAsset;
  if (amountUnit === 'DESTINATION') return request.destinationAsset;
  return undefined;
}

export interface RuleIssue {
  /** error: the request is invalid or will lose funds. warning: legal but probably not intended. */
  level: 'error' | 'warning';
  message: string;
}

const MAX_BPS = 10_000;

/**
 * appFees are capped at 500 bps (5%) per the fee-config docs, far below the
 * slippage ceiling. Note also that a 50/50 revenue share applies by default:
 * half of `fee` reaches your recipient, half goes to 1Click.
 */
const MAX_APP_FEE_BPS = 500;

/**
 * Validates a quote request against the swap-type matrix before it costs a
 * network round trip. Catches the combinations the API rejects, plus the
 * ones it accepts but that mean something other than what you expect.
 */
export function validateQuoteRequest(request: QuoteRequest): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const rule = ruleFor(request.swapType);

  if (!rule.depositTypes.includes(request.depositType)) {
    issues.push({
      level: 'error',
      message:
        `depositType ${request.depositType} is not supported for ${request.swapType}. ` +
        `Supported: ${rule.depositTypes.join(', ')}.`,
    });
  }

  if (rule.requiredOriginAsset && request.originAsset !== rule.requiredOriginAsset) {
    issues.push({
      level: 'error',
      message: `${request.swapType} requires originAsset "${rule.requiredOriginAsset}", got "${request.originAsset}".`,
    });
  }

  if (rule.requiredAmount !== undefined && request.amount !== rule.requiredAmount) {
    issues.push({
      level: 'error',
      message: `${request.swapType} requires amount "${rule.requiredAmount}", got "${request.amount}".`,
    });
  } else if (rule.amountUnit !== 'IGNORED') {
    if (!/^\d+$/.test(request.amount)) {
      issues.push({
        level: 'error',
        message: `amount "${request.amount}" must be an integer string in smallest units.`,
      });
    } else if (BigInt(request.amount) === 0n) {
      issues.push({ level: 'error', message: `amount must be greater than zero for ${request.swapType}.` });
    }
  }

  const deadline = Date.parse(request.deadline);
  if (Number.isNaN(deadline)) {
    issues.push({ level: 'error', message: `deadline "${request.deadline}" is not a valid ISO timestamp.` });
  } else if (deadline <= Date.now()) {
    issues.push({ level: 'error', message: `deadline ${request.deadline} is in the past.` });
  }

  if (!Number.isInteger(request.slippageTolerance) || request.slippageTolerance < 0) {
    issues.push({
      level: 'error',
      message: `slippageTolerance must be a non-negative integer in basis points, got ${request.slippageTolerance}.`,
    });
  } else if (request.slippageTolerance > MAX_BPS) {
    issues.push({
      level: 'error',
      message: `slippageTolerance ${request.slippageTolerance} exceeds ${MAX_BPS} bps (100%).`,
    });
  }

  for (const appFee of request.appFees ?? []) {
    if (!appFee.recipient) {
      issues.push({ level: 'error', message: 'appFees entries need a recipient account.' });
    }
    if (!Number.isInteger(appFee.fee) || appFee.fee <= 0 || appFee.fee > MAX_APP_FEE_BPS) {
      issues.push({
        level: 'error',
        message: `appFees fee ${appFee.fee} must be an integer between 1 and ${MAX_APP_FEE_BPS} basis points (5% cap).`,
      });
    }
  }

  if (!rule.refundable && request.refundTo) {
    issues.push({
      level: 'warning',
      message: `${request.swapType} swaps are never refunded; refundTo/refundType are ignored and failures retry instead.`,
    });
  }

  if (rule.amountUnit === 'IGNORED' && request.slippageTolerance > 0) {
    issues.push({
      level: 'warning',
      message: `${request.swapType} has no fixed rate (conversion happens at sweep time), so slippageTolerance is ignored.`,
    });
  }

  if (rule.amountUnit === 'DESTINATION') {
    issues.push({
      level: 'warning',
      message: `${request.swapType}: amount is denominated in destinationAsset (${request.destinationAsset}), not originAsset.`,
    });
  }

  return issues;
}

/** Convenience: just the blocking issues. */
export function quoteRequestErrors(request: QuoteRequest): string[] {
  return validateQuoteRequest(request)
    .filter((issue) => issue.level === 'error')
    .map((issue) => issue.message);
}

export interface QuoteGuarantees {
  swapType: SwapType;
  /** The quoted deposit amount, smallest units */
  fundQuoted?: string;
  /** Fund at least this much or the deposit is refunded, smallest units */
  fundAtLeast?: string;
  /** The quoted payout, smallest units */
  receiveQuoted?: string;
  /** The worst-case payout you are guaranteed, smallest units */
  receiveAtLeast?: string;
  settlesToTerminalStatus: boolean;
  refundable: boolean;
  /** Human-readable caveats worth showing a user before they commit */
  notes: string[];
}

/**
 * Reads the fields that actually matter for this quote's swap type.
 *
 * Showing amountIn for every swap type is wrong: for EXACT_OUTPUT the number
 * that decides refund-versus-swap is minAmountIn, and for FLEX_INPUT the
 * payout you can rely on is minAmountOut, not amountOut.
 */
export function quoteGuarantees(response: QuoteResponse): QuoteGuarantees {
  const { swapType } = response.quoteRequest;
  const rule = ruleFor(swapType);
  const { quote } = response;
  const notes = [rule.summary];

  if (!rule.settlesToTerminalStatus) {
    notes.push('Polling GET /v0/status for a terminal state will never finish; list sweeps instead.');
  }

  return {
    swapType,
    fundQuoted: quote.amountIn,
    fundAtLeast: rule.fundingFloor ? quote[rule.fundingFloor] : undefined,
    receiveQuoted: quote.amountOut,
    receiveAtLeast: rule.payoutFloor ? quote[rule.payoutFloor] : undefined,
    settlesToTerminalStatus: rule.settlesToTerminalStatus,
    refundable: rule.refundable,
    notes,
  };
}
