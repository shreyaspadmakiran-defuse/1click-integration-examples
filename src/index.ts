// Library entry point. Import from here when using this repo as a module:
//   import { OneClickClient, ShieldClient, startOriginChainSwap } from 'defuse-1click-integration-example';

export * from './types/one-click';
export * from './types/shield';
export * from './types/explorer';
export * from './types/intents-contract';

export { OneClickClient, OneClickClientOptions } from './client/one-click-client';
export { ShieldClient, ShieldClientOptions } from './client/shield-client';
export { ExplorerClient, ExplorerClientOptions } from './client/explorer-client';
export { IntentsContractClient, IntentsContractClientOptions } from './client/intents-contract-client';
export { ApiError, HttpClient } from './client/http';

export { startOriginChainSwap, OriginChainSwapHandle } from './flows/swap-origin-chain';
export { executeSignedIntentSwap, IntentSigner, SignedIntentSwapResult } from './flows/swap-signed-intent';
export { pollUntilSettled, PollOptions } from './flows/poll-status';
export { preflight, PreflightResult } from './flows/preflight';
export { submitIntentSafely, SafeSubmitResult } from './flows/submit-intent-safely';
export {
  handleStatusNotification,
  handleNotificationRequest,
  extractSwapRef,
  SwapRef,
  NotificationResult,
  NotificationOptions,
} from './flows/status-notification';

export { parseAmount, formatAmount } from './utils/amounts';
export { TokenRegistry } from './utils/token-registry';
export { buildQuoteRequest, BuildQuoteInput } from './utils/quote-builder';
export { classifyError, explainError, isRetryable, isAmbiguous, ErrorAdvice, ErrorKind } from './utils/errors';
export { FileOrderStore, OrderStore, SwapOrder } from './utils/order-store';
export { verifyQuote } from './utils/verify-quote';
export { withRetry, sleep } from './utils/retry';
export { logger, setLogLevel } from './utils/logger';

// For testing your integration offline. There is no NEAR Intents testnet,
// so this is how you get an automated test suite.
export { MockOneClickClient, MockOneClickOptions, MockSwap, MOCK_TOKENS } from './testing/mock-client';

export { loadEnv, AppEnv } from './config/env';
export * from './config/constants';
export {
  SWAP_TYPE_RULES,
  SwapTypeRule,
  AmountUnit,
  RuleIssue,
  QuoteGuarantees,
  ruleFor,
  amountAssetId,
  validateQuoteRequest,
  quoteRequestErrors,
  quoteGuarantees,
} from './config/swap-rules';
