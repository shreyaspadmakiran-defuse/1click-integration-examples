# defuse-1click-integration-example

A working reference integration for the [NEAR Intents 1Click API](https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api): a typed client for every route, Shield incident handling, modular end-to-end swap flows, runnable examples, and a CLI for interacting with all of it.

This repo is code, not documentation. For concepts, parameters, and API reference, use the official docs at [docs.near-intents.org](https://docs.near-intents.org). Use this repo to see the full lifecycle running: quote, deposit (on-chain or signed intent), status polling, Shield checks, and quote signature verification.

## Read this first: there is no testnet

> **"There is no testnet version of NEAR Intents - use small amounts for test swaps."**
> ([official quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/introduction))

Every call in this repo hits mainnet. Every quote with `dry: false` allocates a real deposit address.

What protects you is `dry: true`. A dry quote prices a real swap against real solvers and commits to nothing: no deposit address, no funds, no limit on how often you call it. Build and verify everything against dry quotes, then make your first real swap a tiny one.

A dry quote and a real one differ in exactly one field, so default `dry` to `true` and make `dry: false` an explicit, reviewed decision in your code. Walk through it in [`examples/00-start-here/03-no-testnet.ts`](examples/00-start-here/03-no-testnet.ts).

## Prerequisites

- Node.js v20.18+ with NPM

## Installation

```bash
npm install
```

## First five minutes

```bash
npm install
npx ts-node examples/00-start-here/01-hello-1click.ts      # a full quote, no credentials
npx ts-node examples/00-start-here/02-which-integration.ts # which options fit your use case
npx ts-node examples/00-start-here/03-no-testnet.ts        # how to develop safely
```

## Configuration

Everything is optional: public endpoints (`/v0/tokens`, `/v0/quote`, `/v0/status`) work with zero credentials. Copy `env/.env.example` to `env/.env.local` and fill in what you have:

| Variable | Used for | Get it from |
| --- | --- | --- |
| `ONE_CLICK_JWT` | Fee-free quotes (without it every swap carries a 0.2% platform fee) | [Partner Dashboard](https://partners.near-intents.org/home) |
| `ONE_CLICK_API_KEY` | Signed intent execution (`/v0/generate-intent`, `/v0/submit-intent`, sent as `X-API-Key`) | Partner Dashboard |
| `SHIELD_TOKEN` | [Shield Incident API](https://docs.near-intents.org/security-compliance/shield-incident-api) and the preflight shield check | [API Keys page](https://partners.near-intents.org/api-keys), request `key_type: SHIELD` |

Run with an env file the same way as the other Defuse examples:

```bash
NODE_ENV=local npm run cli -- tokens
```

## Quick start

```bash
# What can I swap?
npm run cli -- tokens --chain near

# Price 1 wNEAR into USDT (dry: safe, no commitment)
npm run cli -- quote \
  --from nep141:wrap.near \
  --to nep141:usdt.tether-token.near \
  --amount 1 --human \
  --recipient your-account.near --recipient-type INTENTS

# Commit: same command plus --execute prints a real deposit address
# Then track it:
npm run cli -- status <depositAddress> --watch

# Shield incidents (needs SHIELD_TOKEN)
npm run cli -- shield status
```

## Swap types change the meaning of your request

`swapType` changes which token `amount` is denominated in, which `depositType`s are legal, which quote field tells you how much to actually send, and whether the swap ever reaches a terminal status. Getting this wrong is silent: `10` encoded with the wrong token's decimals is still a perfectly valid request.

The matrix lives in [src/config/swap-rules.ts](src/config/swap-rules.ts) as data, so the flows, the CLI, and the tests all read the same rules. Print it with `npm run cli -- swap-types`.

| | `amount` is in | depositTypes | Fund at least | Receive at least | Settles? |
| --- | --- | --- | --- | --- | --- |
| `EXACT_INPUT` | origin units | all three | `amountIn` | `minAmountOut` | yes |
| `EXACT_OUTPUT` | **destination units** | all three | `minAmountIn` | `amountOut` | yes |
| `FLEX_INPUT` | origin units | not `CONFIDENTIAL_INTENTS` | `minAmountIn` | `minAmountOut` | yes |
| `ANY_INPUT` | ignored, always `"0"` | `INTENTS`, `CONFIDENTIAL_INTENTS` | n/a | n/a | **no** |

Three consequences:

- **`EXACT_OUTPUT` counts in the destination token.** Converting a human amount with the origin token's decimals is off by the difference between the two, silently. `amountAssetId()` picks the right one, and `1click quote --human` prints which token and how many decimals it used.
- **`amountIn` is not always the number to show a user.** For `EXACT_OUTPUT` and `FLEX_INPUT` the value that decides refund-versus-swap is `minAmountIn`. `quoteGuarantees()` reads the correct field per swap type.
- **`ANY_INPUT` never reaches `SUCCESS`.** Deposits accumulate and are swept on a threshold, so polling `/v0/status` for a terminal state just burns the timeout. Reconcile with `getAnyInputWithdrawals()` instead. `pollUntilSettled()` detects this and warns.

`validateQuoteRequest()` checks all of it locally, so an illegal combination fails before it costs a round trip (and, with `--execute`, before it allocates a real deposit address):

```ts
const problems = quoteRequestErrors(request);
if (problems.length) throw new Error(problems.join('; '));
```

`preflight()` runs this first and skips the dry quote entirely when the request cannot succeed. The rules are asserted in [test/swap-rules.test.ts](test/swap-rules.test.ts), and [examples/02-quotes/](examples/02-quotes/) has one runnable file per swap type.

### Confidential intents

`CONFIDENTIAL_INTENTS` follows the same four steps as `INTENTS`: generate, sign, submit, poll, via `executeSignedIntentSwap()`. Auth is split across those steps:

| Step | Credential |
| --- | --- |
| `POST /v0/quote` (confidential) | The end user's **User-Session token** from `authenticate()`, passed as `getQuote(request, accessToken)`. Pricing reads a private balance, so the partner JWT alone returns 401. |
| `POST /v0/generate-intent` | Partner **`X-API-Key`** |
| `POST /v0/submit-intent` | Partner **`X-API-Key`**. The user's authorization here is the wallet signature inside `signedData`, not a token. |

A confidential swap therefore needs both credentials, at different steps. A public `INTENTS` swap needs only the partner key. `FLEX_INPUT` does not support `CONFIDENTIAL_INTENTS` at all, and the validator rejects that pair locally.

Request a level with `confidentiality: 'public' | 'basic' | 'advanced'` on the quote, or `--confidentiality` on the CLI. Worked through in [examples/03-swaps/03-confidential.ts](examples/03-swaps/03-confidential.ts).

## CLI commands

Every 1Click and Shield route is reachable from the terminal. `npm run cli -- --help` for full options.

| Command | Route | Notes |
| --- | --- | --- |
| `tokens` | `GET /v0/tokens` | Filter with `--chain`, `--symbol`, `--search` |
| `quote` | `POST /v0/quote` | Dry by default; `--execute` allocates a real deposit address; `--human` converts using the decimals of whichever token the swap type denominates `amount` in; `--app-fee your-fees.near:30` adds your integrator fee; `--referral` tags volume; `--confidentiality` sets the privacy level |
| `swap-types` | local | Print the swap-type matrix: units, legal depositTypes, and what each type guarantees |
| `status <addr>` | `GET /v0/status` | `--watch` polls to a terminal state; `--memo` when the quote had a depositMemo |
| `orders` | local | Swaps executed from this machine (`~/.1click/orders.json`); `--open` filters to unsettled ones |
| `submit-deposit <addr> <txHash>` | `POST /v0/deposit/submit` | Speeds up deposit detection |
| `withdrawals <addr>` | `GET /v0/any-input/withdrawals` | ANY_INPUT sweep reconciliation |
| `generate-intent <addr>` | `POST /v0/generate-intent` | Needs `ONE_CLICK_API_KEY`; `--signer`, `--standard` |
| `submit-intent --file signed.json` | `POST /v0/submit-intent` | Needs `ONE_CLICK_API_KEY` |
| `preflight` | Shield + dry quote | Exit code 2 when blocked |
| `shield status` / `shield submit` | `GET/POST /incident` | Needs `SHIELD_TOKEN`; submitting also needs incident permissions |
| `convert` | local | Human units to smallest units and back, using live decimals |

## Using it as a library

```ts
import { OneClickClient, ShieldClient, preflight, startOriginChainSwap } from './src';

const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

// 1. Preflight: shield incidents + dry quote, commits to nothing
const check = await preflight(client, { ...request, dry: true }, { shield });
if (!check.ok) throw new Error(check.problems.join('; '));

// 2. Execute: quote -> verify signature -> deposit instructions
const swap = await startOriginChainSwap(client, request);
console.log('fund this address:', swap.depositAddress);

// 3. After you broadcast the deposit from your own wallet infra:
const result = await swap.settle({ txHash });
console.log(result.status); // SUCCESS | REFUNDED | FAILED
```

For funds already inside NEAR Intents (or confidential balances), use `executeSignedIntentSwap()` and plug your wallet into the `IntentSigner` callback. This repo never holds private keys.

Behavior to copy into your own integration:

- **The swap-type matrix is enforced, not documented.** `validateQuoteRequest()` rejects illegal combinations locally, and `quoteGuarantees()` reads the field that carries the promise for that swap type instead of always showing `amountIn`. See the section above.
- **Quote signatures are verified** before any deposit address is trusted, via the official SDK's `verifyQuoteSignature` ([why](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature)).
- **Only idempotent calls are retried.** GETs and dry quotes retry on 429/5xx; `submit-intent` and non-dry quotes never auto-retry, so an ambiguous failure cannot double-submit.
- **Failures are classified before they are handled.** `classifyError()` answers the only question that matters after a failed call: retryable (send it again), ambiguous (it may have been applied, so read state instead), or terminal (fix the request). A timeout on a GET and the same timeout on `submit-intent` are not the same event.
- **Ambiguous submit failures recover through status, not resubmission.** `submitIntentSafely()` rethrows 4xx (definitive rejection), but on a timeout or 5xx it checks `/v0/status` first: if the intent already landed it returns the recorded hash, and only resubmits when the swap is provably still waiting.
- **Every executed swap is persisted immediately.** The deposit address, correlation id, and intent hash are the only keys that can reconstruct a swap later. The CLI models this with a small `FileOrderStore` (`1click orders`); in a real service this is a database table keyed by deposit address.
- **Amounts use BigInt math** (`parseAmount` / `formatAmount`), never floats, with decimals resolved from `/v0/tokens`.
- **`depositMemo` is threaded through everywhere** (deposit, `/v0/deposit/submit`, `/v0/status`), since memo chains 404 without it.
- **Shield being unreachable degrades to a warning**, not a hard block: Shield being down is not the same as a chain being down.
- **Status polling has an overall timeout** and emits only on transitions.

## Examples: the starter pack

**This is the main deliverable.** 28 standalone files covering every endpoint, every swap type, and every variable that changes behavior, with the reasoning in comments beside the code.

Each file stands alone. No shared setup file, no framework to learn: open one, read it top to bottom, run it, copy it into your project.

```bash
npx ts-node examples/02-quotes/02-exact-output.ts
```

| Group | Covers |
| --- | --- |
| [00-start-here](examples/00-start-here/) | A full quote in 30 lines, which options to choose, and safe development without a testnet |
| [01-tokens](examples/01-tokens/) | `GET /v0/tokens`, assetIds, BigInt amount conversion |
| [02-quotes](examples/02-quotes/) | One file per swap type, plus routing, fees, signature verification, and every optional field |
| [03-swaps](examples/03-swaps/) | Origin-chain, signed-intent, confidential, and Earn lifecycles |
| [04-status](examples/04-status/) | Status reads, polling, deposit submission, ANY_INPUT reconciliation |
| [05-account](examples/05-account/) | `authenticate`, `refresh`, `balances`, `history`, and which credential goes where |
| [06-shield](examples/06-shield/) | Incident reads and writes, and degrading instead of failing closed |
| [07-explorer](examples/07-explorer/) | Swap history across all orders, rate limits, cursor paging |
| [08-intents-contract](examples/08-intents-contract/) | Reading `intents.near` directly: balances, nonces, simulation |
| [09-notifications](examples/09-notifications/) | A webhook receiver that push cannot corrupt |
| [10-production](examples/10-production/) | Preflight ordering, error classification, idempotency, persistence |
| [12-operations](examples/12-operations/) | Troubleshooting by symptom, user-facing status, chain requirements |

Everything is dry and read-only by default. Only [03-swaps/01-origin-chain.ts](examples/03-swaps/01-origin-chain.ts) can commit, and only with `EXECUTE=1`. Files needing a credential you lack explain what it unlocks and stop.

[examples/README.md](examples/README.md) has the full index and an endpoint coverage table.

## Testing

```bash
npm test          # unit tests, fully offline (fetch is mocked)
npm run test:e2e  # live but read-only: tokens, dry quotes, signature checks, 404 handling
npm run lint
```

The live suite never moves funds and never allocates deposit addresses (dry quotes only).

## Repo layout

```
src/
  client/     HTTP layer + OneClickClient, ShieldClient, ExplorerClient,
              IntentsContractClient
  flows/      preflight, origin-chain swap, signed-intent swap, safe submit, polling
  config/     env loading, constants, and the swap-type matrix (swap-rules.ts)
  types/      request/response types for 1Click and Shield
  utils/      amounts, token registry, quote builder, error classification,
              order store, retry, logger, quote signature verification
  cli/        the 1click CLI, a thin shell over the above
examples/     the starter pack, grouped by endpoint
test/         unit tests + opt-in live e2e
```

The reusable pieces, in the order you meet them:

| Module | Job |
| --- | --- |
| [TokenRegistry](src/utils/token-registry.ts) | One `GET /v0/tokens` snapshot; resolves decimals and converts amounts |
| [buildQuoteRequest](src/utils/quote-builder.ts) | Human intent into a valid `QuoteRequest`, applying the swap-type rules once |
| [swap-rules](src/config/swap-rules.ts) | The matrix, the validator, and the per-type guarantees |
| [classifyError](src/utils/errors.ts) | Retryable vs ambiguous vs terminal, with a next step |
| [submitIntentSafely](src/flows/submit-intent-safely.ts) | Ambiguous-submit recovery through a status read |
| [FileOrderStore](src/utils/order-store.ts) | Durable record keyed by deposit address |
| [IntentsContractClient](src/client/intents-contract-client.ts) | On-chain truth: balances, nonce checks, intent simulation |
| [ExplorerClient](src/client/explorer-client.ts) | Swap history, self-throttled and cursor paginated |
| [handleStatusNotification](src/flows/status-notification.ts) | Webhook handling that verifies rather than trusts |

The CLI and every example are built from these, so there is one implementation of each rule rather than three.

## Docker

```bash
docker build -t 1click-cli .
docker run --rm -e ONE_CLICK_JWT 1click-cli tokens --chain near
```

## Official documentation

- [1Click quickstart](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request): the flow this repo implements
- [Swap types](https://docs.near-intents.org/integration/distribution-channels/1click-api/swap-types): EXACT_INPUT, EXACT_OUTPUT, FLEX_INPUT, ANY_INPUT
- [Signed intent execution](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution): the INTENTS / CONFIDENTIAL_INTENTS path
- [API keys and authentication](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication)
- [Fee configuration](https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config): appFees and fee aggregation
- [Shield Incident API](https://docs.near-intents.org/security-compliance/shield-incident-api)
- [NEAR Intents Explorer](https://explorer.near-intents.org): look up any swap by deposit address
- Support: [Telegram](https://t.me/near_intents)

## License

MIT
