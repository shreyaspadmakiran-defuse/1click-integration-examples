/**
 * START HERE. A complete price quote in about 30 lines, no credentials.
 *
 * This is the whole shape of a 1Click integration:
 *
 *   1. GET  /v0/tokens   find the assetIds and decimals
 *   2. POST /v0/quote    price it (dry = simulation, commits to nothing)
 *   3. verify            check 1Click's signature on the response
 *   4. GET  /v0/status   track it, once a real swap exists
 *
 * Everything else in this repo is a variation on those four calls. If you
 * understand this file, you understand the API surface.
 *
 * AUTH  none. Public endpoints.
 * RUN   npx ts-node examples/00-start-here/01-hello-1click.ts
 */
import { OneClickClient, formatAmount, parseAmount, verifyQuote } from '../../src';

async function main(): Promise<void> {
  const client = new OneClickClient();

  // 1. Discover what you can swap. assetId is the only identifier the API
  //    accepts, and decimals is the only way to read any amount it returns.
  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  const usdt = tokens.find((t) => t.assetId === 'nep141:usdt.tether-token.near');
  if (!wnear || !usdt) throw new Error('Expected assets not listed');

  console.log(`${tokens.length} tokens available`);
  console.log(`swapping ${wnear.symbol} (${wnear.decimals} decimals) -> ${usdt.symbol} (${usdt.decimals} decimals)\n`);

  // 2. Price it. dry:true means simulate: no deposit address, no commitment,
  //    call it as often as you like.
  const quote = await client.getQuote({
    dry: true,
    swapType: 'EXACT_INPUT', // "I am sending exactly this much"
    slippageTolerance: 100, // basis points, so 1%

    originAsset: wnear.assetId,
    depositType: 'ORIGIN_CHAIN', // funds arrive from a chain
    amount: parseAmount('1', wnear.decimals), // 1 wNEAR, in smallest units

    destinationAsset: usdt.assetId,
    recipient: 'example.near',
    recipientType: 'INTENTS', // output stays inside NEAR Intents

    refundTo: 'example.near',
    refundType: 'ORIGIN_CHAIN', // refunds go back the way they came

    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  });

  // 3. Verify. The response carries the deposit address your user would fund,
  //    so a tampered response could redirect their money. Never skip this.
  if (!verifyQuote(quote)) throw new Error('Quote signature invalid');

  console.log(`send    ${quote.quote.amountInFormatted} wNEAR`);
  console.log(`receive ${quote.quote.amountOutFormatted} USDT`);
  console.log(`floor   ${formatAmount(quote.quote.minAmountOut, usdt.decimals)} USDT (guaranteed after slippage)`);
  console.log(`time    about ${quote.quote.timeEstimate}s`);
  console.log(`\nsignature verified: ${verifyQuote(quote)}`);
  console.log(`deposit address:    ${quote.quote.depositAddress ?? 'none, because dry:true'}`);

  console.log('\nTo actually swap, you would:');
  console.log('  - re-quote with dry:false, which returns a real deposit address');
  console.log('  - save that address to your database BEFORE any funds move');
  console.log('  - send the deposit from your own wallet');
  console.log('  - poll GET /v0/status until SUCCESS, REFUNDED, or FAILED');

  console.log('\nNext:');
  console.log('  00-start-here/02-which-integration.ts  which options fit your use case');
  console.log('  00-start-here/03-no-testnet.ts         how to develop safely (important)');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
