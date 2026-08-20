/**
 * Types for the 1Click API (https://1click.chaindefuser.com).
 * Shapes mirror the official OpenAPI spec and the
 * @defuse-protocol/one-click-sdk-typescript models.
 */

export type SwapType = 'EXACT_INPUT' | 'EXACT_OUTPUT' | 'FLEX_INPUT' | 'ANY_INPUT';
export type DepositType = 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
export type RefundType = 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
export type RecipientType = 'DESTINATION_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
export type Confidentiality = 'public' | 'basic' | 'advanced';
export type DepositMode = 'SIMPLE' | 'MEMO';

export type SigningStandard = 'nep413' | 'erc191' | 'raw_ed25519' | 'webauthn' | 'ton_connect' | 'sep53' | 'tip191';

export interface TokenInfo {
  /** Canonical asset id, e.g. "nep141:wrap.near" or "1cs_v1:hypercore:erc20:0x..." */
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string | null;
}

export interface AppFee {
  /** Intents account that collects the fee */
  recipient: string;
  /** Fee in basis points (100 = 1%) */
  fee: number;
}

export interface QuoteRequest {
  /** true = simulate only, no deposit address is generated */
  dry: boolean;
  swapType: SwapType;
  /** Basis points, 100 = 1% */
  slippageTolerance: number;
  originAsset: string;
  depositType: DepositType;
  destinationAsset: string;
  /** Smallest units (wei, yoctoNEAR, ...). "0" for ANY_INPUT */
  amount: string;
  refundTo: string;
  refundType: RefundType;
  recipient: string;
  recipientType: RecipientType;
  /** ISO timestamp; the quote and its deposit address expire at this time */
  deadline: string;
  depositMode?: DepositMode;
  connectedWallets?: string[];
  sessionId?: string;
  virtualChainRecipient?: string;
  virtualChainRefundRecipient?: string;
  customRecipientMsg?: string;
  confidentiality?: Confidentiality;
  referral?: string;
  quoteWaitingTimeMs?: number;
  appFees?: AppFee[];
}

export interface Quote {
  /** Present only when dry=false */
  depositAddress?: string;
  /** Present for chains that need a memo (depositMode MEMO). Must be sent with the deposit and passed to /v0/status */
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  /** Estimated execution time in seconds */
  timeEstimate: number;
  virtualChainRecipient?: string;
  virtualChainRefundRecipient?: string;
  customRecipientMsg?: string;
  refundFee?: string;
  withdrawFee?: string;
}

export interface QuoteResponse {
  correlationId: string;
  timestamp: string;
  /** Ed25519 signature by 1Click over the quote payload, see the README section on quote signature verification */
  signature: string;
  quoteRequest: QuoteRequest;
  quote: Quote;
}

export type SwapStatus =
  | 'PENDING_DEPOSIT'
  | 'KNOWN_DEPOSIT_TX'
  | 'INCOMPLETE_DEPOSIT'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'FAILED';

export const TERMINAL_STATUSES: SwapStatus[] = ['SUCCESS', 'REFUNDED', 'FAILED'];

export interface TransactionDetails {
  hash: string;
  explorerUrl?: string;
}

export interface SwapDetails {
  intentHashes: string[];
  nearTxHashes: string[];
  amountIn?: string;
  amountInFormatted?: string;
  amountInUsd?: string;
  amountOut?: string;
  amountOutFormatted?: string;
  amountOutUsd?: string;
  slippage?: number;
  originChainTxHashes?: TransactionDetails[];
  destinationChainTxHashes?: TransactionDetails[];
  refundedAmount?: string;
  refundedAmountFormatted?: string;
  refundedAmountUsd?: string;
}

export interface ExecutionStatus {
  correlationId: string;
  quoteResponse: QuoteResponse;
  status: SwapStatus;
  updatedAt: string;
  swapDetails: SwapDetails;
}

export interface SubmitDepositTxRequest {
  txHash: string;
  depositAddress: string;
  /** Required when the deposit was made from a NEAR account via a relayer */
  nearSenderAccount?: string;
  /** Required when the quote included a depositMemo */
  memo?: string;
}

export interface AnyInputWithdrawal {
  timestamp: string;
  amountOut: string;
  amountOutFormatted?: string;
  amountOutUsd?: string;
  txHash?: string;
  [key: string]: unknown;
}

export interface AnyInputWithdrawalsResponse {
  withdrawals: AnyInputWithdrawal[];
  page?: number;
  limit?: number;
  total?: number;
  [key: string]: unknown;
}

export interface GenerateIntentRequest {
  type: 'swap_transfer';
  standard: SigningStandard;
  /** Account that will sign the intent (the owner of the Intents balance) */
  signerId: string;
  /** depositAddress returned by the quote, links the intent to the quote */
  depositAddress: string;
}

export interface IntentPayloadNep413 {
  recipient: string;
  nonce: string;
  message: string;
  callbackUrl?: string;
}

export interface UnsignedIntent {
  standard: SigningStandard;
  payload: IntentPayloadNep413 | Record<string, unknown>;
}

export interface GenerateIntentResponse {
  intent: UnsignedIntent;
  correlationId: string;
}

/** The signed MultiPayload: the generated intent plus the wallet's key and signature */
export interface SignedIntentData {
  standard: SigningStandard;
  payload: IntentPayloadNep413 | Record<string, unknown>;
  public_key?: string;
  signature: string;
  [key: string]: unknown;
}

export interface SubmitIntentRequest {
  type: 'swap_transfer';
  signedData: SignedIntentData;
}

export interface SubmitIntentResponse {
  intentHash: string;
  correlationId: string;
}

export interface AuthenticateRequest {
  signedData: SignedIntentData;
}

export interface AuthenticateResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

export interface AccountBalance {
  assetId: string;
  balance: string;
  [key: string]: unknown;
}

/** One row of GET /v0/account/history, scoped to the authenticated account */
export interface AccountHistoryEntry {
  depositAddress?: string;
  depositMemo?: string;
  status?: SwapStatus;
  originAsset?: string;
  destinationAsset?: string;
  amountIn?: string;
  amountOut?: string;
  createdAt?: string;
  [key: string]: unknown;
}
