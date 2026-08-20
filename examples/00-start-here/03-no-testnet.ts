/**
 * THERE IS NO TESTNET. Read this before you write any integration code.
 *
 * The official guidance is explicit: "There is no testnet version of NEAR
 * Intents - use small amounts for test swaps."
 *
 * Every call in this repo hits mainnet. Every quote with dry:false allocates
 * a real deposit address. Every deposit you send is real money.
 *
 * That has consequences most teams discover late:
 *   - you cannot write a CI test that performs a swap
 *   - you cannot test the REFUNDED path by waiting for one to happen
 *   - you cannot test a 5xx, a timeout, or a rate limit on demand
 *   - a bug in a retry loop can spend real funds repeatedly
 *
 * THE THREE-LAYER STRATEGY THAT WORKS
 *
 *   LAYER 1  Free, unlimited, safe: dry quotes against mainnet.
 *            dry:true prices a real swap and commits to NOTHING. No deposit
 *            address, no funds. Use it for pricing, validation, and to
 *            confirm your request shape is accepted.
 *
 *   LAYER 2  Offline and deterministic: MockOneClickClient.
 *            This is your automated test suite. It implements the same
 *            interface with in-memory state, so you can test refunds,
 *            failures, memo chains, and timeouts. See 11-testing/.
 *
 *   LAYER 3  Small real swaps, done manually, at the end.
 *            A handful of minimum-size mainnet swaps to confirm the parts
 *            layers 1 and 2 cannot cover: real solver pricing, real deposit
 *            detection, real settlement timing.
 *
 * Do NOT skip to layer 3. Most integration bugs are in your own state
 * machine, and layers 1 and 2 find those for free.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/00-start-here/03-no-testnet.ts
 */
import { MockOneClickClient, OneClickClient, parseAmount, verifyQuote } from '../../src';

async function main(): Promise<void> {
  console.log('LAYER 1: dry quotes against mainnet. Free, safe, unlimited.\n');

  const live = new OneClickClient();
  const tokens = await live.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  const usdt = tokens.find((t) => t.assetId === 'nep141:usdt.tether-token.near');
  if (!wnear || !usdt) throw new Error('Expected assets not listed');

  const request = {
    dry: true as const,
    swapType: 'EXACT_INPUT' as const,
    slippageTolerance: 100,
    originAsset: wnear.assetId,
    depositType: 'ORIGIN_CHAIN' as const,
    amount: parseAmount('1', wnear.decimals),
    destinationAsset: usdt.assetId,
    recipient: 'example.near',
    recipientType: 'INTENTS' as const,
    refundTo: 'example.near',
    refundType: 'ORIGIN_CHAIN' as const,
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  const dryQuote = await live.getQuote(request);
  console.log(
    `  real mainnet price: ${dryQuote.quote.amountInFormatted} wNEAR -> ${dryQuote.quote.amountOutFormatted} USDT`,
  );
  console.log(`  deposit address:    ${dryQuote.quote.depositAddress ?? 'NONE (nothing was committed)'}`);
  console.log(`  signature verifies: ${verifyQuote(dryQuote)}`);
  console.log('  This cost nothing and cannot lose funds. Use it freely.\n');

  console.log('LAYER 2: MockOneClickClient. Offline, deterministic, testable.\n');

  // The happy path.
  const mock = new MockOneClickClient();
  const mockQuote = await mock.getQuote({ ...request, dry: false });
  console.log(`  mock deposit address: ${mockQuote.quote.depositAddress}`);

  let status = await mock.getStatus(mockQuote.quote.depositAddress as string);
  const seen = [status.status];
  while (!['SUCCESS', 'REFUNDED', 'FAILED'].includes(status.status)) {
    status = await mock.getStatus(mockQuote.quote.depositAddress as string);
    seen.push(status.status);
  }
  console.log(`  status progression:   ${seen.join(' -> ')}`);

  // The refund path, which you cannot trigger on demand in production.
  const refunding = new MockOneClickClient({
    statusSequence: ['PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT', 'REFUNDED'],
  });
  const refundQuote = await refunding.getQuote({ ...request, dry: false });
  const address = refundQuote.quote.depositAddress as string;
  let refundStatus = await refunding.getStatus(address);
  while (refundStatus.status !== 'REFUNDED') refundStatus = await refunding.getStatus(address);
  console.log(
    `  refund path tested:   ${refundStatus.status}, ${refundStatus.swapDetails?.refundedAmountFormatted} returned`,
  );

  // A server error, on demand.
  const failing = new MockOneClickClient();
  failing.failNext('getQuote');
  try {
    await failing.getQuote(request);
  } catch (error) {
    console.log(`  injected failure:     ${error instanceof Error ? error.message.slice(0, 60) : error}`);
  }
  console.log('  None of that touched the network or spent anything.\n');

  console.log('LAYER 3: small real swaps, manually, last.\n');
  const oneCent = (0.01 / wnear.price).toFixed(6);
  console.log(`  wNEAR is about $${wnear.price}, so ~$0.01 is roughly ${oneCent} wNEAR`);
  console.log(`  = ${parseAmount(oneCent, wnear.decimals)} in smallest units`);
  console.log('  Start near the chain minimum. If it is too small, the API rejects the quote,');
  console.log('  which is itself a safe way to discover the floor.');
  console.log('\n  Before your first real swap, confirm:');
  console.log('    - refundTo is an address YOU control on the right chain');
  console.log('    - you persist depositAddress BEFORE sending funds');
  console.log('    - you handle REFUNDED, not just SUCCESS');
  console.log('    - your retry logic cannot resend a deposit');

  console.log('\nOne more warning specific to having no testnet:');
  console.log('  A dry quote and a real quote differ in exactly one field: `dry`.');
  console.log('  A stray dry:false in a loop is a real, funded, repeated commitment.');
  console.log('  Default that flag to true and make dry:false an explicit, reviewed decision.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
