# The 1Click starter pack

Every endpoint, every swap type, every variable that changes behavior, and the practices that keep an integration correct in production. The code is the documentation.

Each file is **standalone**. No shared setup file, no framework: open one, read it top to bottom, run it, copy it into your project. The header comment explains the variables, the body shows the calls, and error handling is written inline where it is the lesson.

```bash
npx ts-node examples/00-start-here/01-hello-1click.ts
```

> **There is no testnet for NEAR Intents.** Everything here hits mainnet. Dry quotes commit nothing and are safe to run freely; only `EXECUTE=1` on [03-swaps/01-origin-chain.ts](03-swaps/01-origin-chain.ts) can spend anything. Read [00-start-here/03-no-testnet.ts](00-start-here/03-no-testnet.ts) before writing integration code.

Files needing a credential you lack explain what it unlocks and stop, rather than failing.

## Read in order

### 00-start-here: orientation

| File | Teaches |
| --- | --- |
| [01-hello-1click.ts](00-start-here/01-hello-1click.ts) | The entire API shape in 30 lines: tokens, quote, verify, status |
| [02-which-integration.ts](00-start-here/02-which-integration.ts) | Which `swapType` / `depositType` / `recipientType` fits your use case |
| [03-no-testnet.ts](00-start-here/03-no-testnet.ts) | **Important.** There is no testnet; the three-layer strategy that works |

### 01-tokens: the vocabulary

| File | Endpoint | Teaches |
| --- | --- | --- |
| [01-list-tokens.ts](01-tokens/01-list-tokens.ts) | `GET /v0/tokens` | `assetId` is the only identifier; symbols repeat across chains |
| [02-amount-conversion.ts](01-tokens/02-amount-conversion.ts) | none | Smallest units, BigInt over floats, the right token's decimals |

### 02-quotes: `POST /v0/quote`, one file per variable

`swapType` changes what the other fields mean, so it gets one file each.

| File | Focus | What changes |
| --- | --- | --- |
| [01-exact-input.ts](02-quotes/01-exact-input.ts) | `EXACT_INPUT` | You fix the input; slippage moves the output; floor is `minAmountOut` |
| [02-exact-output.ts](02-quotes/02-exact-output.ts) | `EXACT_OUTPUT` | `amount` is in **destination** units; refund threshold is `minAmountIn` |
| [03-flex-input.ts](02-quotes/03-flex-input.ts) | `FLEX_INPUT` | A band, not a number; no `CONFIDENTIAL_INTENTS` |
| [04-any-input.ts](02-quotes/04-any-input.ts) | `ANY_INPUT` | Fixed `originAsset`/`amount`; no rate, no refunds, never terminal |
| [05-routing-types.ts](02-quotes/05-routing-types.ts) | `depositType` / `recipientType` / `refundType` | `recipient` must be valid for `recipientType` |
| [06-app-fees.ts](02-quotes/06-app-fees.ts) | `appFees`, `referral` | 500 bps cap, 50/50 revenue share, and the fee lands on a different side per swap type |
| [07-verify-signature.ts](02-quotes/07-verify-signature.ts) | `signature` | The check that protects the deposit address |
| [08-optional-fields.ts](02-quotes/08-optional-fields.ts) | `deadline`, `depositMemo`, `quoteWaitingTimeMs`, virtual chains | Memo loss is the top cause of "my swap vanished" |

### 03-swaps: the execution flows

| File | Flow | Needs |
| --- | --- | --- |
| [01-origin-chain.ts](03-swaps/01-origin-chain.ts) | quote, fund, detect, settle | nothing (JWT optional) |
| [02-signed-intent.ts](03-swaps/02-signed-intent.ts) | `generate-intent`, sign, `submit-intent`, poll | `ONE_CLICK_API_KEY` |
| [03-confidential.ts](03-swaps/03-confidential.ts) | the same, plus `confidentiality` | user token **and** API key |
| [04-earn.ts](03-swaps/04-earn.ts) | 1Click Earn | nothing |

### 04-status: tracking

| File | Endpoint |
| --- | --- |
| [01-get-status.ts](04-status/01-get-status.ts) | `GET /v0/status` |
| [02-poll-until-settled.ts](04-status/02-poll-until-settled.ts) | polling, done correctly |
| [03-submit-deposit-tx.ts](04-status/03-submit-deposit-tx.ts) | `POST /v0/deposit/submit` |
| [04-any-input-withdrawals.ts](04-status/04-any-input-withdrawals.ts) | `GET /v0/any-input/withdrawals` |

### 05-account: the user-session credential

| File | Endpoints |
| --- | --- |
| [01-authenticate-and-refresh.ts](05-account/01-authenticate-and-refresh.ts) | `POST /v0/auth/authenticate`, `POST /v0/auth/refresh` |
| [02-balances-and-history.ts](05-account/02-balances-and-history.ts) | `GET /v0/account/balances`, `GET /v0/account/history` |

### 06-shield: risk

| File | Endpoints |
| --- | --- |
| [01-incidents.ts](06-shield/01-incidents.ts) | `GET /incident`, `POST /incident` |

### 07-explorer: history across all your swaps

| File | Endpoints |
| --- | --- |
| [01-transactions.ts](07-explorer/01-transactions.ts) | `GET /transactions`, `GET /partner-any-quotes` |

### 08-intents-contract: on-chain truth

| File | View calls |
| --- | --- |
| [01-balances-and-nonces.ts](08-intents-contract/01-balances-and-nonces.ts) | `mt_batch_balance_of`, `is_nonce_used` |
| [02-simulate-intents.ts](08-intents-contract/02-simulate-intents.ts) | `simulate_intents` |

### 09-notifications: push instead of polling

| File | Teaches |
| --- | --- |
| [01-webhook-receiver.ts](09-notifications/01-webhook-receiver.ts) | A receiver a forged or redelivered notification cannot corrupt |

### 10-production: read before you ship

| File | Teaches |
| --- | --- |
| [01-preflight.ts](10-production/01-preflight.ts) | Validate cheapest-first; degrade instead of failing closed |
| [02-error-handling.ts](10-production/02-error-handling.ts) | Retryable vs ambiguous vs terminal, against real failures |
| [03-idempotency-and-recovery.ts](10-production/03-idempotency-and-recovery.ts) | Surviving an ambiguous submit; persist before funds move |

### 11-testing: because there is no testnet

| File | Teaches |
| --- | --- |
| [01-testing-your-integration.ts](11-testing/01-testing-your-integration.ts) | Eight offline assertions covering refunds, memo 404s, and double-submit protection |

### 12-operations: running it

| File | Teaches |
| --- | --- |
| [01-troubleshooting.ts](12-operations/01-troubleshooting.ts) | Symptom catalog, plus live diagnosis of a given deposit address |
| [02-user-facing-status.ts](12-operations/02-user-facing-status.ts) | What to show users per status, and why `terminal` is not `fulfilled` |
| [03-chain-requirements.ts](12-operations/03-chain-requirements.ts) | Address formats, memo chains, decimals that vary by chain |

## Credentials

Public endpoints need nothing. Copy `env/.env.example` to `env/.env.local` and export what you have.

| Variable | Unlocks | Where to get it |
| --- | --- | --- |
| `ONE_CLICK_JWT` | Fee-free quotes (saves 0.2%), `ANY_INPUT`, the Explorer API | [Partner Dashboard](https://partners.near-intents.org/home) |
| `ONE_CLICK_API_KEY` | `/v0/generate-intent`, `/v0/submit-intent` | Partner Dashboard, sent as `X-API-Key` |
| `SHIELD_TOKEN` | Shield incident reads and writes | [API Keys](https://partners.near-intents.org/api-keys), request `key_type: SHIELD` |
| `USER_ACCESS_TOKEN` | Account balances and history, confidential quotes | Not a dashboard key. Your **end user's** wallet signature, exchanged via `authenticate()`. See [05-account/01](05-account/01-authenticate-and-refresh.ts) |

The first three identify *you*. The last identifies *your user*. They are not interchangeable: a valid partner JWT still returns 401 on a route expecting the user token.

## Endpoint coverage

| Endpoint | Example |
| --- | --- |
| `GET /v0/tokens` | 01-tokens/01 |
| `POST /v0/quote` | all of 02-quotes |
| `GET /v0/status` | 04-status/01, 04-status/02 |
| `POST /v0/deposit/submit` | 04-status/03 |
| `GET /v0/any-input/withdrawals` | 04-status/04 |
| `POST /v0/generate-intent` | 03-swaps/02 |
| `POST /v0/submit-intent` | 03-swaps/02, 10-production/03 |
| `POST /v0/auth/authenticate` | 05-account/01 |
| `POST /v0/auth/refresh` | 05-account/01 |
| `GET /v0/account/balances` | 05-account/02 |
| `GET /v0/account/history` | 05-account/02 |
| `GET /incident` (Shield) | 06-shield/01 |
| `POST /incident` (Shield) | 06-shield/01 |
| `GET /transactions` (Explorer) | 07-explorer/01 |
| `GET /partner-any-quotes` (Explorer) | 07-explorer/01 |
| `mt_batch_balance_of` (contract) | 08-intents-contract/01 |
| `is_nonce_used` (contract) | 08-intents-contract/01 |
| `simulate_intents` (contract) | 08-intents-contract/02 |
