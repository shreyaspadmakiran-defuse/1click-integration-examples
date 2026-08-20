/**
 * Types for the Intents Explorer API (read-only swap history).
 * https://docs.near-intents.org/near-intents/integration/distribution-channels/intents-explorer-api
 */
import { AppFee, SwapStatus, TransactionDetails } from './one-click';

export interface ExplorerTransaction {
  originAsset: string;
  destinationAsset: string;
  depositAddress: string;
  depositMemo?: string | null;
  /** The composite key the cursor pages on */
  depositAddressAndMemo?: string;
  recipient: string;
  recipientType?: string;
  refundTo?: string;
  refundType?: string;
  depositType?: string;
  status: SwapStatus;
  createdAt: string;
  createdAtTimestamp?: number;
  intentHashes?: string[];
  nearTxHashes?: string[];
  originChainTxHashes?: TransactionDetails[];
  destinationChainTxHashes?: TransactionDetails[];
  amountIn?: string;
  amountInFormatted?: string;
  amountInUsd?: string;
  amountOut?: string;
  amountOutFormatted?: string;
  amountOutUsd?: string;
  refundReason?: string | null;
  refundFee?: string;
  refundFeeFormatted?: string;
  referral?: string;
  appFees?: AppFee[];
  senders?: string[];
  [key: string]: unknown;
}

/**
 * Cursor-based, not offset-based. You resume from the last row you saw
 * rather than from a page number, so rows arriving mid-scan cannot shift
 * pages under you and cause skips or duplicates.
 */
export interface ExplorerTransactionsQuery {
  /** Page size, 1 to 1000 */
  numberOfTransactions?: number;
  /** Cursor: the depositAddress of the last row from the previous page */
  lastDepositAddress?: string;
  /** Cursor: that row's depositMemo, when it had one */
  lastDepositMemo?: string;
  /** Which way to page from the cursor */
  direction?: 'next' | 'prev';
  search?: string;
  fromChainId?: string;
  fromTokenId?: string;
  toChainId?: string;
  toTokenId?: string;
  depositMemo?: string;
  referral?: string;
  affiliate?: string;
  /** Comma-separated SwapStatus values */
  statuses?: string;
  showTestTxs?: string;
  minUsdPrice?: number;
  maxUsdPrice?: number;
  /** ISO 8601 */
  startTimestamp?: string;
  endTimestamp?: string;
  startTimestampUnix?: number;
  endTimestampUnix?: number;
}

export interface ExplorerTransactionsResponse {
  transactions: ExplorerTransaction[];
  [key: string]: unknown;
}
