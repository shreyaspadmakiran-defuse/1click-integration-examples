/**
 * Builds a valid QuoteRequest from human-level intent.
 *
 * This exists so the swap-type rules are applied in exactly one place. It
 * resolves the fields that depend on swapType (which token `amount` counts
 * in, the fixed originAsset and amount for ANY_INPUT), fills the boilerplate
 * (deadline, refund defaults), and refuses to return a request the matrix
 * already rejects.
 */
import { DEFAULT_QUOTE_DEADLINE_MS } from '../config/constants';
import { amountAssetId, quoteRequestErrors, ruleFor } from '../config/swap-rules';
import {
  AppFee,
  Confidentiality,
  DepositType,
  QuoteRequest,
  RecipientType,
  RefundType,
  SwapType,
} from '../types/one-click';
import { TokenRegistry } from './token-registry';

export interface BuildQuoteInput {
  swapType: SwapType;
  /** Origin assetId. Ignored for ANY_INPUT, which fixes its own. */
  from: string;
  to: string;
  /**
   * Smallest units by default. With `human: true` this is a decimal string
   * converted using the decimals of whichever token this swap type
   * denominates `amount` in, which is NOT always the origin token.
   */
  amount: string;
  human?: boolean;
  recipient: string;
  recipientType: RecipientType;
  depositType: DepositType;
  /** Defaults to `recipient` */
  refundTo?: string;
  /** Defaults to a refund target consistent with depositType */
  refundType?: RefundType;
  /** Basis points, 100 = 1%. Defaults to 100. */
  slippageBps?: number;
  /** Offset from now. Defaults to DEFAULT_QUOTE_DEADLINE_MS. */
  deadlineMs?: number;
  /** Defaults to true: simulate, commit to nothing. */
  dry?: boolean;
  appFees?: AppFee[];
  referral?: string;
  confidentiality?: Confidentiality;
}

/** A deposit that came from Intents should be refunded back into Intents. */
function defaultRefundType(depositType: DepositType): RefundType {
  return depositType === 'ORIGIN_CHAIN' ? 'ORIGIN_CHAIN' : 'INTENTS';
}

/**
 * Throws when the resulting request violates the swap-type matrix, so an
 * invalid request never reaches the network (and never allocates a deposit
 * address when dry is false).
 */
export function buildQuoteRequest(input: BuildQuoteInput, registry?: TokenRegistry): QuoteRequest {
  const rule = ruleFor(input.swapType);

  // ANY_INPUT pins both of these; supplying anything else is an error.
  const originAsset = rule.requiredOriginAsset ?? input.from;

  let amount = rule.requiredAmount ?? input.amount;
  if (rule.requiredAmount === undefined && input.human) {
    if (!registry) {
      throw new Error('buildQuoteRequest: a TokenRegistry is required to convert human amounts');
    }
    const assetId = amountAssetId({ swapType: input.swapType, originAsset, destinationAsset: input.to });
    amount = registry.parse(input.amount, assetId as string);
  }

  const request: QuoteRequest = {
    dry: input.dry ?? true,
    swapType: input.swapType,
    slippageTolerance: input.slippageBps ?? 100,
    originAsset,
    depositType: input.depositType,
    destinationAsset: input.to,
    amount,
    recipient: input.recipient,
    recipientType: input.recipientType,
    refundTo: input.refundTo ?? input.recipient,
    refundType: input.refundType ?? defaultRefundType(input.depositType),
    deadline: new Date(Date.now() + (input.deadlineMs ?? DEFAULT_QUOTE_DEADLINE_MS)).toISOString(),
    ...(input.referral ? { referral: input.referral } : {}),
    ...(input.appFees?.length ? { appFees: input.appFees } : {}),
    ...(input.confidentiality ? { confidentiality: input.confidentiality } : {}),
  };

  const errors = quoteRequestErrors(request);
  if (errors.length > 0) {
    throw new Error(`Invalid ${input.swapType} quote request:\n  - ${errors.join('\n  - ')}`);
  }
  return request;
}
