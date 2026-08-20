export const ONE_CLICK_BASE_URL = 'https://1click.chaindefuser.com';
export const SHIELD_BASE_URL = 'https://shield.chaindefuser.com';

export const PARTNER_DASHBOARD_URL = 'https://partners.near-intents.org';
export const INTENTS_EXPLORER_URL = 'https://explorer.near-intents.org';

/** Read-only history API mirroring the Intents Explorer */
export const EXPLORER_API_BASE_URL = 'https://explorer.near-intents.org/api/v0';

/**
 * The Explorer API allows one request every 5 seconds per partner id and
 * returns 429 beyond that, so the client paces itself rather than relying on
 * callers to remember.
 */
export const EXPLORER_MIN_REQUEST_INTERVAL_MS = 5_000;

/** The Intents verifier contract: the on-chain source of truth for balances and nonces */
export const INTENTS_CONTRACT_ID = 'intents.near';

/** Public NEAR RPC used for read-only view calls */
export const NEAR_RPC_URL = 'https://rpc.mainnet.near.org';

/** Default deadline offset for quotes: 10 minutes */
export const DEFAULT_QUOTE_DEADLINE_MS = 10 * 60 * 1000;

/** Default status polling cadence */
export const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** Give up polling after 30 minutes by default */
export const DEFAULT_POLL_TIMEOUT_MS = 30 * 60 * 1000;
