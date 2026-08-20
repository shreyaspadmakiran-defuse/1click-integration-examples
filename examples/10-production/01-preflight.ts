/**
 * Preflight: everything to check BEFORE you commit to a swap.
 *
 * A quote with dry:false allocates a real deposit address and a live price.
 * Everything that can be validated for free should be validated before that
 * line, in this order, cheapest first:
 *
 *   1. LOCAL RULES     swap-type matrix, deadline, slippage, fee caps.
 *                      Costs nothing, catches the structural mistakes.
 *   2. BALANCE         can the account actually fund it? Free view call.
 *   3. SHIELD          is this route paused right now?
 *   4. DRY QUOTE       does the API accept it, and at what price?
 *
 *   Only then: dry:false.
 *
 * WHY THE ORDER MATTERS
 *   Each step is more expensive than the last. Running a dry quote to
 *   discover that ANY_INPUT cannot use ORIGIN_CHAIN wastes a round trip on
 *   something a local check answers instantly.
 *
 * DEGRADE, DO NOT FAIL CLOSED
 *   Shield being unreachable is not the same as the swap being unsafe. It
 *   becomes a warning, not a block. Failing closed on someone else's outage
 *   takes YOUR integration down for no safety benefit.
 *
 * AUTH  none required. SHIELD_TOKEN enables the incident check.
 * RUN   npx ts-node examples/10-production/01-preflight.ts
 */
import {
  IntentsContractClient,
  OneClickClient,
  QuoteRequest,
  ShieldClient,
  parseAmount,
  preflight,
  validateQuoteRequest,
} from '../../src';

const ACCOUNT = 'example.near';

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });
  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  if (!wnear) throw new Error('wNEAR not listed');

  const request: QuoteRequest = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: wnear.assetId,
    depositType: 'INTENTS',
    amount: parseAmount('1', wnear.decimals),
    destinationAsset: 'nep141:usdt.tether-token.near',
    recipient: ACCOUNT,
    recipientType: 'INTENTS',
    refundTo: ACCOUNT,
    refundType: 'INTENTS',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  // STEP 1. Free, instant, no network.
  console.log('1. Local rule check');
  const issues = validateQuoteRequest(request);
  const errors = issues.filter((issue) => issue.level === 'error');
  for (const issue of issues) console.log(`   ${issue.level}: ${issue.message}`);
  if (issues.length === 0) console.log('   clean');
  if (errors.length > 0) {
    console.log('\n   Stopping. No point spending a network call on an invalid request.');
    return;
  }

  // STEP 2. Free view call, no credentials, no user token needed.
  console.log('\n2. Balance check (only meaningful for depositType INTENTS)');
  if (request.depositType === 'INTENTS') {
    const contract = new IntentsContractClient();
    const [held] = await contract.balances(ACCOUNT, [request.originAsset]);
    const sufficient = BigInt(held ?? '0') >= BigInt(request.amount);
    console.log(`   holds ${held ?? '0'}, needs ${request.amount}`);
    console.log(`   sufficient: ${sufficient}`);
    if (!sufficient) {
      console.log('   In production, stop here with a clear "insufficient balance" error');
      console.log('   rather than letting the swap stall unfunded until the deadline.');
    }
  } else {
    console.log('   skipped: ORIGIN_CHAIN deposits are funded after the quote');
  }

  // STEPS 3 and 4, both inside preflight().
  console.log('\n3 & 4. Shield incidents + dry quote');
  const shieldToken = process.env.SHIELD_TOKEN;
  const result = await preflight(client, request, {
    shield: shieldToken ? new ShieldClient({ token: shieldToken }) : undefined,
    tokens, // reuse the list we already have rather than refetching
  });

  console.log(`   ok: ${result.ok}`);
  console.log(`   blocking incidents: ${result.blockingIncidents.length}`);
  for (const problem of result.problems) console.log(`   problem: ${problem}`);
  for (const warning of result.warnings) console.log(`   warning: ${warning}`);
  if (!shieldToken) console.log('   (SHIELD_TOKEN unset, so the incident check was skipped entirely)');

  if (result.dryQuote) {
    console.log(
      `\n   priced: ${result.dryQuote.quote.amountInFormatted} -> ${result.dryQuote.quote.amountOutFormatted}`,
    );
    console.log(`   estimated time: ${result.dryQuote.quote.timeEstimate}s`);
  }

  console.log(`\nSafe to commit with dry:false? ${result.ok}`);
  console.log('\nNote a Shield outage appears as a `problem` entry but does NOT set ok=false.');
  console.log('A Shield outage degrades to a warning rather than blocking the swap.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
