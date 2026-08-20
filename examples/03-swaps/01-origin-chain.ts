/**
 * The ORIGIN_CHAIN lifecycle, end to end.
 *
 * THE SEQUENCE
 *   1. quote dry:true       free. Validates the request, previews pricing.
 *   2. quote dry:false      THE COMMIT. Allocates a real deposit address.
 *   3. verify the signature before trusting that address
 *   4. PERSIST immediately  before any funds move
 *   5. broadcast the deposit from your own wallet infrastructure
 *   6. submitDepositTx()    optional, speeds up detection
 *   7. poll /v0/status      to SUCCESS, REFUNDED, or FAILED
 *
 * WHY STEP 4 COMES BEFORE STEP 5
 *   The deposit address is the ONLY key that can reconstruct this swap. If
 *   your process dies between step 2 and writing it down, and the user has
 *   already sent funds, you cannot look the swap up, cannot show status, and
 *   cannot help support find it. Write first, then move money.
 *
 * FROM THE GOING-LIVE CHECKLIST
 *   - verify the deposit address matches the quote response
 *   - verify you send the exact amount the quote specifies
 *   - verify the destination address format suits the target chain
 *   - allow up to 15 minutes for cross-chain processing
 *
 * AUTH  none required. ONE_CLICK_JWT removes the 0.2% platform fee.
 * RUN   npx ts-node examples/03-swaps/01-origin-chain.ts
 *       EXECUTE=1 npx ts-node examples/03-swaps/01-origin-chain.ts
 */
import { FileOrderStore, OneClickClient, QuoteRequest, parseAmount, pollUntilSettled, verifyQuote } from '../../src';
import * as os from 'os';
import * as path from 'path';

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });
  const execute = process.env.EXECUTE === '1';

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  const ethOnNear = tokens.find((t) => t.assetId === 'nep141:eth.omft.near');
  if (!wnear || !ethOnNear) throw new Error('Expected assets not listed');

  const request: QuoteRequest = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: wnear.assetId,
    depositType: 'ORIGIN_CHAIN',
    amount: parseAmount('1', wnear.decimals),
    destinationAsset: ethOnNear.assetId,
    // DESTINATION_CHAIN means this must be a valid address on the target chain.
    recipient: '0x0000000000000000000000000000000000000001',
    recipientType: 'DESTINATION_CHAIN',
    // Refunds go back the way the funds came in.
    refundTo: 'example.near',
    refundType: 'ORIGIN_CHAIN',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  // STEP 1. Free, commits to nothing.
  const preview = await client.getQuote(request);
  console.log('Step 1, dry quote:');
  console.log(`  send    ${preview.quote.amountInFormatted} wNEAR`);
  console.log(`  receive ${preview.quote.amountOutFormatted} ETH (min ${preview.quote.minAmountOut})`);
  console.log(`  deposit address: ${preview.quote.depositAddress ?? 'none, as expected for a dry quote'}`);

  if (!execute) {
    console.log('\nStopping here. Set EXECUTE=1 to allocate a real deposit address.');
    return;
  }

  // STEP 2. This costs something: the address is real and the quote is live.
  const quote = await client.getQuote({ ...request, dry: false });

  // STEP 3. Never trust a deposit address from an unverified quote.
  if (!verifyQuote(quote)) {
    throw new Error('Quote signature verification failed, refusing to use the deposit address');
  }
  const depositAddress = quote.quote.depositAddress;
  if (!depositAddress) throw new Error('No depositAddress in a non-dry quote');
  console.log(`\nStep 2-3, committed and verified: ${depositAddress}`);

  // STEP 4. Before any funds move. A database row in a real service.
  const store = new FileOrderStore(path.join(os.homedir(), '.1click', 'orders.json'));
  store.save({
    depositAddress,
    depositMemo: quote.quote.depositMemo,
    correlationId: quote.correlationId,
    originAsset: request.originAsset,
    destinationAsset: request.destinationAsset,
    amountIn: quote.quote.amountIn,
    amountOut: quote.quote.amountOut,
    status: 'PENDING_DEPOSIT',
  });
  console.log('Step 4, persisted before funding. This is the ordering that matters.');

  // STEP 5. Yours to do. This repo never holds keys.
  console.log('\nStep 5, broadcast the deposit yourself:');
  console.log(`  send exactly ${quote.quote.amountInFormatted} wNEAR to ${depositAddress}`);
  if (quote.quote.depositMemo) {
    console.log(`  WITH memo ${quote.quote.depositMemo} (required on this chain)`);
  }
  console.log(`  before ${quote.quote.deadline}`);

  const txHash = process.env.DEPOSIT_TX_HASH;
  if (!txHash) {
    console.log('\nSet DEPOSIT_TX_HASH=<hash> after broadcasting to continue to steps 6-7.');
    return;
  }

  // STEP 6. Optional accelerator. Safe to repeat.
  await client.submitDepositTx({ depositAddress, txHash, memo: quote.quote.depositMemo });
  store.save({ depositAddress, txHash });
  console.log(`\nStep 6, reported tx ${txHash}`);

  // STEP 7. Allow up to 15 minutes for cross-chain processing.
  const final = await pollUntilSettled(client, depositAddress, {
    depositMemo: quote.quote.depositMemo,
    timeoutMs: 15 * 60_000,
    onUpdate: (status) => console.log(`  ${status.status} at ${status.updatedAt}`),
  });
  store.save({ depositAddress, status: final.status, intentHash: final.swapDetails?.intentHashes?.[0] });
  console.log(`\nStep 7, settled: ${final.status}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
