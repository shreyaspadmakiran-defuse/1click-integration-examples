#!/usr/bin/env node
/**
 * 1click CLI: interact with every 1Click API route and the Shield
 * Incident API from the terminal.
 *
 *   npm run cli -- tokens --chain near
 *   npm run cli -- quote --from nep141:wrap.near --to nep141:usdt.tether-token.near --amount 1 ...
 *   npm run cli -- status <depositAddress> --watch
 *   npm run cli -- shield status
 *
 * Credentials come from env/.env.{NODE_ENV} or exported variables,
 * see env/.env.example.
 */
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadEnv } from '../config/env';
import { OneClickClient } from '../client/one-click-client';
import { ShieldClient } from '../client/shield-client';
import { pollUntilSettled } from '../flows/poll-status';
import { preflight } from '../flows/preflight';
import { parseAmount, formatAmount } from '../utils/amounts';
import { verifyQuote } from '../utils/verify-quote';
import { setLogLevel } from '../utils/logger';
import { DEFAULT_QUOTE_DEADLINE_MS, INTENTS_EXPLORER_URL } from '../config/constants';
import {
  AppFee,
  Confidentiality,
  ExecutionStatus,
  QuoteRequest,
  QuoteResponse,
  SigningStandard,
  SwapType,
} from '../types/one-click';
import { ShieldDirection, ShieldScopeType } from '../types/shield';
import { FileOrderStore } from '../utils/order-store';
import { amountAssetId, quoteGuarantees, ruleFor, SWAP_TYPE_RULES, validateQuoteRequest } from '../config/swap-rules';
import { TokenRegistry } from '../utils/token-registry';
import { buildQuoteRequest } from '../utils/quote-builder';

const env = loadEnv();
setLogLevel(env.logLevel);

function oneClick(): OneClickClient {
  return new OneClickClient({
    baseUrl: env.oneClickBaseUrl,
    jwt: env.oneClickJwt,
    apiKey: env.oneClickApiKey,
  });
}

function shield(): ShieldClient {
  if (!env.shieldToken) {
    fail('SHIELD_TOKEN is not set. Get a token with key_type SHIELD at https://partners.near-intents.org/api-keys');
  }
  return new ShieldClient({ baseUrl: env.shieldBaseUrl, token: env.shieldToken as string });
}

function ordersFile(): string {
  return process.env.ORDERS_FILE || path.join(os.homedir(), '.1click', 'orders.json');
}

function orderStore(): FileOrderStore {
  return new FileOrderStore(ordersFile());
}

/** Keep the local order record in sync whenever we see fresh status */
function recordStatus(depositAddress: string, status: ExecutionStatus): void {
  if (orderStore().get(depositAddress)) {
    orderStore().save({
      depositAddress,
      status: status.status,
      intentHash: status.swapDetails?.intentHashes?.[0],
    });
  }
}

function print(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Which quote fields carry the promise depends on the swap type, so print
 * those rather than always showing amountIn/amountOut.
 */
function printGuarantees(quote: QuoteResponse): void {
  const g = quoteGuarantees(quote);
  const lines = [`\n${g.swapType}: ${g.notes.join(' ')}`];
  if (g.fundAtLeast) lines.push(`  fund at least: ${g.fundAtLeast} (quoted ${g.fundQuoted})`);
  if (g.receiveAtLeast) lines.push(`  receive at least: ${g.receiveAtLeast} (quoted ${g.receiveQuoted})`);
  if (!g.refundable) lines.push('  no refunds: failed swaps retry rather than return funds');
  console.error(lines.join('\n'));
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

const program = new Command();
program.name('1click').description('CLI for the NEAR Intents 1Click API and Shield Incident API').version('0.1.0');

program
  .command('tokens')
  .description('List supported tokens (GET /v0/tokens)')
  .option('--chain <chain>', 'filter by blockchain, e.g. near, eth, sol')
  .option('--symbol <symbol>', 'filter by symbol, case-insensitive')
  .option('--search <text>', 'substring match on assetId')
  .action((opts) =>
    run(async () => {
      let tokens = await oneClick().getTokens();
      if (opts.chain) tokens = tokens.filter((t) => t.blockchain === opts.chain.toLowerCase());
      if (opts.symbol) tokens = tokens.filter((t) => t.symbol.toLowerCase() === opts.symbol.toLowerCase());
      if (opts.search) tokens = tokens.filter((t) => t.assetId.includes(opts.search));
      print(tokens);
      console.error(`\n${tokens.length} token(s)`);
    }),
  );

interface QuoteCliOptions {
  from: string;
  to: string;
  amount: string;
  human?: boolean;
  recipient?: string;
  refundTo?: string;
  swapType: string;
  depositType: string;
  recipientType: string;
  refundType: string;
  slippage: string;
  deadlineMinutes: string;
  execute?: boolean;
  referral?: string;
  appFee?: AppFee[];
  confidentiality?: string;
}

/** "your-fees.near:30" -> { recipient: 'your-fees.near', fee: 30 } */
function parseAppFee(value: string, previous: AppFee[] = []): AppFee[] {
  const separator = value.lastIndexOf(':');
  const recipient = value.slice(0, separator);
  const fee = Number(value.slice(separator + 1));
  if (separator < 1 || !Number.isInteger(fee) || fee <= 0) {
    fail(`Invalid --app-fee "${value}", expected <recipient>:<bps>, e.g. your-fees.near:30`);
  }
  return [...previous, { recipient, fee }];
}

/**
 * Delegates to the shared buildQuoteRequest so the CLI, the flows, and the
 * examples all apply the swap-type rules identically.
 */
async function buildRequestFromCli(opts: QuoteCliOptions): Promise<QuoteRequest> {
  if (!opts.recipient) fail('--recipient is required');

  const swapType = opts.swapType as SwapType;
  if (!(swapType in SWAP_TYPE_RULES)) {
    fail(`Unknown --swap-type "${swapType}", expected one of ${Object.keys(SWAP_TYPE_RULES).join(', ')}`);
  }

  // Only fetch the token list when we actually need decimals.
  const registry = opts.human ? await TokenRegistry.load(oneClick()) : undefined;

  try {
    const request = buildQuoteRequest(
      {
        swapType,
        from: opts.from,
        to: opts.to,
        amount: opts.amount,
        human: opts.human,
        recipient: opts.recipient,
        recipientType: opts.recipientType as QuoteRequest['recipientType'],
        depositType: opts.depositType as QuoteRequest['depositType'],
        refundTo: opts.refundTo,
        refundType: opts.refundType as QuoteRequest['refundType'],
        slippageBps: Number(opts.slippage),
        deadlineMs: Number(opts.deadlineMinutes) * 60_000,
        dry: !opts.execute,
        appFees: opts.appFee,
        referral: opts.referral,
        confidentiality: opts.confidentiality as Confidentiality | undefined,
      },
      registry,
    );
    if (opts.human) {
      const assetId = amountAssetId(request);
      console.error(`--human: ${opts.amount} -> ${request.amount} using ${assetId}`);
    }
    return request;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

program
  .command('quote')
  .description('Request a quote (POST /v0/quote). Dry by default; pass --execute to get a real deposit address')
  .requiredOption('--from <assetId>', 'origin assetId, e.g. nep141:wrap.near')
  .requiredOption('--to <assetId>', 'destination assetId')
  .requiredOption('--amount <amount>', 'amount in smallest units, or human units with --human')
  .option('--human', 'treat --amount as human units and convert using token decimals')
  .option('--recipient <address>', 'address receiving the output')
  .option('--refund-to <address>', 'refund address (defaults to recipient)')
  .option('--swap-type <type>', 'EXACT_INPUT | EXACT_OUTPUT | FLEX_INPUT | ANY_INPUT', 'EXACT_INPUT')
  .option('--deposit-type <type>', 'ORIGIN_CHAIN | INTENTS | CONFIDENTIAL_INTENTS', 'ORIGIN_CHAIN')
  .option('--recipient-type <type>', 'DESTINATION_CHAIN | INTENTS | CONFIDENTIAL_INTENTS', 'DESTINATION_CHAIN')
  .option('--refund-type <type>', 'ORIGIN_CHAIN | INTENTS | CONFIDENTIAL_INTENTS', 'ORIGIN_CHAIN')
  .option('--slippage <bps>', 'slippage tolerance in basis points (100 = 1%)', '100')
  .option('--deadline-minutes <min>', 'quote deadline from now', '10')
  .option('--referral <id>', 'referral tag for analytics')
  .option('--app-fee <recipient:bps>', 'your integrator fee, repeatable, e.g. your-fees.near:30', parseAppFee)
  .option('--confidentiality <level>', 'public | basic | advanced')
  .option('--execute', 'dry=false: generates a real deposit address you must fund')
  .action((opts: QuoteCliOptions) =>
    run(async () => {
      const request = await buildRequestFromCli(opts);

      // Fail locally on illegal combinations rather than round-tripping them.
      const issues = validateQuoteRequest(request);
      for (const issue of issues.filter((i) => i.level === 'warning')) {
        console.error(`Warning: ${issue.message}`);
      }
      const errors = issues.filter((i) => i.level === 'error');
      if (errors.length > 0) {
        fail(`${request.swapType} request is invalid:\n  - ${errors.map((e) => e.message).join('\n  - ')}`);
      }

      const quote = await oneClick().getQuote(request);
      print(quote);
      console.error(`\nSignature valid: ${verifyQuote(quote)}`);
      printGuarantees(quote);
      if (request.dry) {
        console.error('Dry quote only. Re-run with --execute to get a deposit address.');
      } else if (quote.quote.depositAddress) {
        // Persist the identifiers immediately: the deposit address is the
        // only key that can reconstruct this swap later.
        orderStore().save({
          depositAddress: quote.quote.depositAddress,
          correlationId: quote.correlationId,
          originAsset: request.originAsset,
          destinationAsset: request.destinationAsset,
          amountIn: quote.quote.amountIn,
          amountOut: quote.quote.amountOut,
          depositMemo: quote.quote.depositMemo,
          status: 'PENDING_DEPOSIT',
        });
        // ANY_INPUT never settles, so pointing the user at --watch would strand them.
        const followUp = ruleFor(request.swapType).settlesToTerminalStatus
          ? `1click status ${quote.quote.depositAddress} --watch`
          : `1click withdrawals ${quote.quote.depositAddress}`;
        console.error(
          `\nSend ${quote.quote.amountInFormatted} ${request.originAsset} to ${quote.quote.depositAddress}` +
            (quote.quote.depositMemo ? ` (memo: ${quote.quote.depositMemo})` : '') +
            `\nSaved to ${ordersFile()} (see "1click orders")` +
            `\nThen: ${followUp}`,
        );
      }
    }),
  );

program
  .command('status')
  .description('Check swap status (GET /v0/status)')
  .argument('<depositAddress>', 'deposit address from the quote')
  .option('--memo <memo>', 'depositMemo when the quote included one')
  .option('--watch', 'poll until the swap settles')
  .option('--interval <seconds>', 'polling interval', '5')
  .action((depositAddress: string, opts) =>
    run(async () => {
      const client = oneClick();
      if (opts.watch) {
        const final = await pollUntilSettled(client, depositAddress, {
          depositMemo: opts.memo,
          intervalMs: Number(opts.interval) * 1000,
          onUpdate: (s) => console.error(`status: ${s.status} (updated ${s.updatedAt})`),
        });
        recordStatus(depositAddress, final);
        print(final);
      } else {
        const status = await client.getStatus(depositAddress, opts.memo);
        recordStatus(depositAddress, status);
        print(status);
      }
      console.error(`\nExplorer: ${INTENTS_EXPLORER_URL}/?search=${depositAddress}`);
    }),
  );

program
  .command('submit-deposit')
  .description('Notify 1Click of your deposit tx (POST /v0/deposit/submit)')
  .argument('<depositAddress>')
  .argument('<txHash>')
  .option('--memo <memo>', 'depositMemo when the quote included one')
  .option('--near-sender <accountId>', 'NEAR account that sent the deposit, when relayed')
  .action((depositAddress: string, txHash: string, opts) =>
    run(async () => {
      const status = await oneClick().submitDepositTx({
        depositAddress,
        txHash,
        memo: opts.memo,
        nearSenderAccount: opts.nearSender,
      });
      if (orderStore().get(depositAddress)) orderStore().save({ depositAddress, txHash });
      recordStatus(depositAddress, status);
      print(status);
    }),
  );

program
  .command('orders')
  .description(`List swaps executed from this machine (stored in ${path.join('~', '.1click', 'orders.json')})`)
  .option('--open', 'only orders not yet in a terminal state')
  .action((opts) =>
    run(async () => {
      let orders = orderStore().list();
      if (opts.open) {
        orders = orders.filter((o) => !['SUCCESS', 'REFUNDED', 'FAILED'].includes(o.status ?? ''));
      }
      print(orders);
      console.error(`\n${orders.length} order(s). Refresh one with: 1click status <depositAddress>`);
    }),
  );

program
  .command('withdrawals')
  .description('List ANY_INPUT sweeps for a collection address (GET /v0/any-input/withdrawals)')
  .argument('<depositAddress>')
  .option('--memo <memo>')
  .option('--from <isoTimestamp>', 'only withdrawals after this time')
  .option('--page <n>', 'page number', '1')
  .option('--limit <n>', 'per page, max 50', '50')
  .option('--sort <order>', 'asc | desc', 'desc')
  .action((depositAddress: string, opts) =>
    run(async () => {
      print(
        await oneClick().getAnyInputWithdrawals({
          depositAddress,
          depositMemo: opts.memo,
          timestampFrom: opts.from,
          page: Number(opts.page),
          limit: Number(opts.limit),
          sortOrder: opts.sort,
        }),
      );
    }),
  );

program
  .command('generate-intent')
  .description('Generate an unsigned intent for an INTENTS quote (POST /v0/generate-intent, needs ONE_CLICK_API_KEY)')
  .argument('<depositAddress>', 'deposit address from the quote')
  .requiredOption('--signer <accountId>', 'account that will sign, e.g. user.near')
  .option('--standard <standard>', 'nep413 | erc191 | raw_ed25519 | webauthn | ton_connect | sep53 | tip191', 'nep413')
  .action((depositAddress: string, opts) =>
    run(async () => {
      const generated = await oneClick().generateIntent({
        type: 'swap_transfer',
        standard: opts.standard as SigningStandard,
        signerId: opts.signer,
        depositAddress,
      });
      print(generated);
      console.error(
        '\nSign generated.intent with the wallet, add public_key and signature, save as signed.json, then:' +
          '\n  1click submit-intent --file signed.json',
      );
    }),
  );

program
  .command('submit-intent')
  .description('Submit a signed intent (POST /v0/submit-intent, needs ONE_CLICK_API_KEY)')
  .requiredOption('--file <path>', 'JSON file containing the signed MultiPayload (signedData)')
  .action((opts) =>
    run(async () => {
      const signedData = JSON.parse(fs.readFileSync(opts.file, 'utf-8'));
      print(await oneClick().submitIntent({ type: 'swap_transfer', signedData }));
    }),
  );

program
  .command('preflight')
  .description('Shield incident check + dry quote before committing to a swap')
  .requiredOption('--from <assetId>')
  .requiredOption('--to <assetId>')
  .requiredOption('--amount <amount>', 'smallest units')
  .requiredOption('--recipient <address>')
  .option('--deposit-type <type>', 'ORIGIN_CHAIN | INTENTS | CONFIDENTIAL_INTENTS', 'ORIGIN_CHAIN')
  .option('--recipient-type <type>', 'DESTINATION_CHAIN | INTENTS | CONFIDENTIAL_INTENTS', 'DESTINATION_CHAIN')
  .action((opts) =>
    run(async () => {
      const client = oneClick();
      const request: QuoteRequest = {
        dry: true,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: opts.from,
        depositType: opts.depositType,
        destinationAsset: opts.to,
        amount: opts.amount,
        recipient: opts.recipient,
        recipientType: opts.recipientType,
        refundTo: opts.recipient,
        refundType: opts.depositType === 'ORIGIN_CHAIN' ? 'ORIGIN_CHAIN' : 'INTENTS',
        deadline: new Date(Date.now() + DEFAULT_QUOTE_DEADLINE_MS).toISOString(),
      };
      const result = await preflight(client, request, {
        shield: env.shieldToken ? shield() : undefined,
      });
      print(result);
      process.exit(result.ok ? 0 : 2);
    }),
  );

const shieldCmd = program.command('shield').description('Shield Incident API (needs SHIELD_TOKEN)');

shieldCmd
  .command('status')
  .description('Pull active incidents (GET /incident)')
  .action(() =>
    run(async () => {
      print(await shield().getIncidents());
    }),
  );

shieldCmd
  .command('submit')
  .description('Open a scoped incident (POST /incident, needs incident permissions)')
  .requiredOption('--scope-type <type>', 'chain | bridge | token | address')
  .requiredOption('--scope-value <value>', 'e.g. eth, poa, nep141:<contract>, or an address')
  .option('--direction <direction>', 'deposit | withdraw')
  .option('--description <text>', 'incident context')
  .action((opts) =>
    run(async () => {
      print(
        await shield().submitIncident({
          scopeType: opts.scopeType as ShieldScopeType,
          scopeValue: opts.scopeValue,
          direction: opts.direction as ShieldDirection | undefined,
          description: opts.description,
        }),
      );
    }),
  );

program
  .command('swap-types')
  .description('Print the swap-type matrix: what amount means, which depositTypes are legal, what is guaranteed')
  .action(() =>
    run(async () => {
      for (const [swapType, rule] of Object.entries(SWAP_TYPE_RULES)) {
        const amountMeaning = {
          ORIGIN: 'originAsset units (what you send)',
          DESTINATION: 'destinationAsset units (what you receive)',
          IGNORED: `always "${rule.requiredAmount}", ignored`,
        }[rule.amountUnit];
        console.log(`${swapType}`);
        console.log(`  amount is in:   ${amountMeaning}`);
        console.log(`  depositTypes:   ${rule.depositTypes.join(', ')}`);
        if (rule.requiredOriginAsset) console.log(`  originAsset:    must be ${rule.requiredOriginAsset}`);
        console.log(`  fund at least:  ${rule.fundingFloor ?? 'n/a, no fixed rate'}`);
        console.log(`  receive floor:  ${rule.payoutFloor ?? 'n/a, priced at sweep time'}`);
        console.log(`  settles:        ${rule.settlesToTerminalStatus ? 'yes, poll /v0/status' : 'no, sweeps'}`);
        console.log(`  refundable:     ${rule.refundable ? 'yes' : 'no, failures retry'}`);
        console.log(`  ${rule.summary}\n`);
      }
    }),
  );

program
  .command('convert')
  .description('Convert between human and smallest units using live token decimals')
  .requiredOption('--asset <assetId>')
  .requiredOption('--amount <amount>')
  .option('--to-human', 'convert smallest units to human units (default is human to smallest)')
  .action((opts) =>
    run(async () => {
      const tokens = await oneClick().getTokens();
      const token = tokens.find((t) => t.assetId === opts.asset);
      if (!token) fail(`Unknown asset ${opts.asset}`);
      const t = token as NonNullable<typeof token>;
      console.log(opts.toHuman ? formatAmount(opts.amount, t.decimals) : parseAmount(opts.amount, t.decimals));
    }),
  );

program.parseAsync(process.argv);
