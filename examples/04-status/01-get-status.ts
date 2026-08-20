/**
 * GET /v0/status
 *
 * THE STATE MACHINE
 *   PENDING_DEPOSIT     quoted, nothing received yet
 *   INCOMPLETE_DEPOSIT  received, but below the funding floor
 *   KNOWN_DEPOSIT_TX    deposit seen on chain
 *   PROCESSING          solvers executing
 *   SUCCESS             done
 *   REFUNDED            returned to refundTo
 *   FAILED              terminal failure
 *
 *   The last three are terminal. Everything else can still move.
 *
 * PARAMETERS
 *   depositAddress  the lookup key, and your database key
 *   depositMemo     REQUIRED whenever the quote returned one. Without it the
 *                   lookup 404s, which reads like "this swap does not exist"
 *                   and sends people debugging in entirely the wrong place.
 *
 * WHAT THE RESPONSE CARRIES
 *   quoteResponse   the original request AND quote, so status is
 *                   self-describing. You can recover swapType, amounts, and
 *                   routing from a deposit address alone.
 *   swapDetails     intentHashes, chain tx hashes, actual amounts, refunds
 *
 * BEST PRACTICE
 *   A 404 is usually a missing memo, not a missing swap. Check that first.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/04-status/01-get-status.ts <depositAddress> [memo]
 */
import { OneClickClient, TERMINAL_STATUSES, classifyError } from '../../src';

async function main(): Promise<void> {
  const [depositAddress, memo] = process.argv.slice(2);

  if (!depositAddress) {
    console.log('Usage: npx ts-node examples/04-status/01-get-status.ts <depositAddress> [memo]');
    console.log('\nGet a deposit address from 03-swaps/01-origin-chain.ts with EXECUTE=1,');
    console.log('or from a quote with dry:false.');
    console.log(`\nTerminal statuses: ${TERMINAL_STATUSES.join(', ')}`);
    return;
  }

  const client = new OneClickClient();

  try {
    const status = await client.getStatus(depositAddress, memo);

    console.log(`status:        ${status.status}`);
    console.log(`updatedAt:     ${status.updatedAt}`);
    console.log(`correlationId: ${status.correlationId}`);
    console.log(`terminal:      ${TERMINAL_STATUSES.includes(status.status)}`);

    // The response describes itself: you can rebuild the whole swap from it.
    const original = status.quoteResponse?.quoteRequest;
    if (original) {
      console.log(`\noriginal request:`);
      console.log(`  ${original.swapType}  ${original.depositType} -> ${original.recipientType}`);
      console.log(`  ${original.originAsset} -> ${original.destinationAsset}`);
      console.log(`  recipient ${original.recipient}, refunds to ${original.refundTo}`);
    }

    const details = status.swapDetails;
    if (details) {
      console.log('\nexecution details:');
      if (details.amountInFormatted) console.log(`  actually received:  ${details.amountInFormatted}`);
      if (details.amountOutFormatted) console.log(`  actually delivered: ${details.amountOutFormatted}`);
      if (details.intentHashes?.length) console.log(`  intents:  ${details.intentHashes.join(', ')}`);
      if (details.nearTxHashes?.length) console.log(`  near txs: ${details.nearTxHashes.join(', ')}`);
      for (const tx of details.originChainTxHashes ?? []) console.log(`  origin tx:      ${tx.hash}`);
      for (const tx of details.destinationChainTxHashes ?? []) console.log(`  destination tx: ${tx.hash}`);
      if (details.refundedAmountFormatted) console.log(`  REFUNDED: ${details.refundedAmountFormatted}`);
    }

    console.log(`\nExplorer: https://explorer.near-intents.org/?search=${depositAddress}`);
  } catch (error) {
    const advice = classifyError(error);
    console.error(`\n${advice.kind}: ${error instanceof Error ? error.message : error}`);
    if (advice.kind === 'NOT_FOUND' && !memo) {
      console.error('\nNo memo was passed. If the quote returned a depositMemo, this 404 is');
      console.error('almost certainly that, not a missing swap. Retry with the memo:');
      console.error(`  npx ts-node examples/04-status/01-get-status.ts ${depositAddress} <memo>`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
