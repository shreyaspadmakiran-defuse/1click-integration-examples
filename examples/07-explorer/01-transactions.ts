/**
 * GET /api/v0/transactions  and  GET /api/v0/partner-any-quotes
 *
 * The Explorer API is YOUR swap history as an integrator, across all your
 * users. Different host (explorer.near-intents.org/api/v0), same partner JWT.
 *
 *   GET /v0/status              one swap, right now
 *   Explorer /transactions      all your swaps, historically
 *   /v0/account/history         ONE user's swaps, needs THEIR token
 *
 * TWO CONSTRAINTS SHAPE EVERY USE
 *
 *   RATE LIMIT: one request every 5 seconds per partner id, then 429.
 *   ExplorerClient paces itself, so paging cannot trip it, but a large scan
 *   takes real time. Run it as a background job; never make a web request
 *   wait on it.
 *
 *   CURSOR PAGINATION, not offset. Each page resumes from the last row's
 *   depositAddress rather than a page number. This matters: with offset
 *   paging over live data, rows arriving mid-scan shift everything down and
 *   you silently skip records. Cursors cannot do that.
 *
 * FILTERS
 *   statuses (comma-separated), startTimestamp / endTimestamp (ISO 8601),
 *   fromChainId / toChainId, fromTokenId / toTokenId, referral, affiliate,
 *   minUsdPrice / maxUsdPrice, search, showTestTxs
 *
 * AUTH  ONE_CLICK_JWT.
 * RUN   npx ts-node examples/07-explorer/01-transactions.ts
 */
import { ExplorerClient, classifyError } from '../../src';

async function main(): Promise<void> {
  const jwt = process.env.ONE_CLICK_JWT;

  if (!jwt) {
    console.log('ONE_CLICK_JWT is not set. The Explorer API requires it on every request.');
    console.log('\nWhat this example does with one:');
    console.log('  explorer.getTransactions({ statuses: "SUCCESS", numberOfTransactions: 50 })');
    console.log('  explorer.iterateTransactions({ startTimestamp }, maxPages)  // auto-pages, self-throttled');
    console.log('  explorer.findByDepositAddress(address)                     // support lookup');
    console.log('  explorer.getPartnerAnyQuotes()                             // standing ANY_INPUT addresses');
    return;
  }

  const explorer = new ExplorerClient({ jwt });

  try {
    // One page, newest first.
    const recent = await explorer.getTransactions({ numberOfTransactions: 10 });
    console.log(`${recent.length} recent transaction(s):\n`);
    for (const tx of recent) {
      console.log(
        `  ${tx.createdAt}  ${tx.status.padEnd(16)} ${tx.amountInFormatted ?? tx.amountIn} -> ${
          tx.amountOutFormatted ?? tx.amountOut
        }`,
      );
      console.log(`    ${tx.originAsset} -> ${tx.destinationAsset}`);
      console.log(`    ${tx.depositAddress}${tx.depositMemo ? ` memo ${tx.depositMemo}` : ''}`);
    }

    // Filtered: what went wrong in the last day.
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const failures = await explorer.getTransactions({
      statuses: 'REFUNDED,FAILED',
      startTimestamp: since,
      numberOfTransactions: 20,
    });
    console.log(`\n${failures.length} refunded or failed since ${since}:`);
    for (const tx of failures.slice(0, 5)) {
      console.log(`  ${tx.depositAddress}  ${tx.status}  ${tx.refundReason ?? 'no reason given'}`);
    }

    // Auto-paging. Each page waits out the rate limit automatically, so this
    // deliberately takes ~5s per page.
    console.log('\nCursor paging (2 pages max, ~5s apart by design):');
    let count = 0;
    for await (const tx of explorer.iterateTransactions({ numberOfTransactions: 25 }, 2)) {
      count++;
      if (count <= 3) console.log(`  ${count}. ${tx.depositAddress}  ${tx.status}`);
    }
    console.log(`  ...${count} rows total`);

    // Standing ANY_INPUT collection addresses, which never expire.
    const anyQuotes = await explorer.getPartnerAnyQuotes();
    console.log(`\n${anyQuotes.length} open ANY_INPUT collection address(es)`);
    for (const quote of anyQuotes.slice(0, 5)) {
      console.log(`  ${quote.depositAddress} -> ${quote.destinationAsset}`);
    }

    console.log('\nFor a nightly reconciliation, filter by startTimestamp and let it page.');
    console.log('Persist the newest createdAt you processed and resume from it next run.');
  } catch (error) {
    const advice = classifyError(error);
    console.error(`\n${advice.kind}: ${error instanceof Error ? error.message.slice(0, 160) : error}`);
    if (advice.kind === 'RATE_LIMIT') {
      console.error('  429 despite throttling means another process shares this partner id.');
      console.error('  The limit is per partner, not per client instance.');
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
