/**
 * THERE IS NO TESTNET. Read this before you write any integration code.
 *
 * The official guidance is explicit: "There is no testnet version of NEAR
 * Intents - use small amounts for test swaps."
 *
 * Every call in this repo hits mainnet. Every quote with dry:false allocates a
 * real deposit address. Every deposit you send is real money.
 *
 * WHAT PROTECTS YOU: dry:true
 *   A dry quote prices a real swap against real solvers and commits to
 *   NOTHING. No deposit address is allocated, no funds can move, and there is
 *   no limit on how often you call it. Everything except the final commitment
 *   can be built and verified this way.
 *
 *   A dry quote and a real one differ in exactly ONE field. A stray dry:false
 *   in a loop is a real, funded, repeated commitment. Default the flag to true
 *   and make dry:false an explicit, reviewed decision in your code.
 *
 * WHAT TO VERIFY WITH DRY QUOTES
 *   - your request shape is accepted for every swap type you support
 *   - your amount encoding is right (especially EXACT_OUTPUT decimals)
 *   - your recipient and refundTo formats suit their chains
 *   - your pricing, fee, and slippage display matches what the API returns
 *   - your signature verification runs and passes
 *
 * WHAT DRY QUOTES CANNOT COVER
 *   Deposit detection, settlement timing, and the refund path. Those need a
 *   real swap, which is why the first one should be tiny.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/00-start-here/03-no-testnet.ts
 */
import { OneClickClient, QuoteRequest, parseAmount, quoteRequestErrors, verifyQuote } from '../../src';

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  const usdt = tokens.find((t) => t.assetId === 'nep141:usdt.tether-token.near');
  if (!wnear || !usdt) throw new Error('Expected assets not listed');

  const request: QuoteRequest = {
    dry: true, // the flag that keeps this free
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: wnear.assetId,
    depositType: 'ORIGIN_CHAIN',
    amount: parseAmount('1', wnear.decimals),
    destinationAsset: usdt.assetId,
    recipient: 'example.near',
    recipientType: 'INTENTS',
    refundTo: 'example.near',
    refundType: 'ORIGIN_CHAIN',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  const quote = await client.getQuote(request);

  console.log('A dry quote against mainnet:');
  console.log(`  real price:         ${quote.quote.amountInFormatted} wNEAR -> ${quote.quote.amountOutFormatted} USDT`);
  console.log(`  signature verifies: ${verifyQuote(quote)}`);
  console.log(`  deposit address:    ${quote.quote.depositAddress ?? 'NONE, because nothing was committed'}`);
  console.log('\nReal solvers, real pricing, zero risk. Call it as often as you like.\n');

  // Validation is local, so a malformed request never costs a round trip and
  // can never reach a dry:false call by accident.
  console.log('Local validation catches structural mistakes before any call:');
  const bad = quoteRequestErrors({ ...request, swapType: 'ANY_INPUT' });
  for (const problem of bad) console.log(`  ${problem}`);

  console.log('\nBefore your FIRST real swap, confirm all of these:');
  console.log('  - refundTo is an address YOU control, on the refund chain');
  console.log('  - you persist depositAddress (and depositMemo) BEFORE sending funds');
  console.log('  - you handle REFUNDED and FAILED, not only SUCCESS');
  console.log('  - your retry logic cannot resend a deposit or re-quote with dry:false');
  console.log('  - your poll loop has a timeout');

  // Sizing the first real swap. Small enough to be a rounding error if it goes
  // wrong, large enough to clear whatever minimum the route enforces.
  const oneCent = (0.01 / wnear.price).toFixed(6);
  console.log(`\nSizing a first real swap:`);
  console.log(`  wNEAR is about $${wnear.price}, so ~$0.01 is roughly ${oneCent} wNEAR`);
  console.log(`  = ${parseAmount(oneCent, wnear.decimals)} in smallest units`);
  console.log('  Minimums are not published. Quote your intended amount with dry:true first:');
  console.log('  if it is below the route minimum the quote is rejected, which costs nothing.');

  const tiny = await client
    .getQuote({ ...request, amount: parseAmount(oneCent, wnear.decimals) })
    .then((q) => `accepted, would return ${q.quote.amountOutFormatted} USDT`)
    .catch((error) => `rejected: ${error instanceof Error ? error.message.slice(0, 100) : error}`);
  console.log(`  ${oneCent} wNEAR -> ${tiny}`);

  console.log('\nOnly once a tiny real swap settles end to end should you raise the amount.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
