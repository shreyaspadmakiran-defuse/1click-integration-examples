/**
 * GET /v0/any-input/withdrawals
 *
 * The reconciliation endpoint for ANY_INPUT collection addresses. This
 * REPLACES status polling for that swap type, because an ANY_INPUT swap has
 * no single outcome to poll for: deposits accumulate and are swept
 * periodically, and each sweep is a row here.
 *
 * PARAMETERS
 *   depositAddress  the collection address
 *   depositMemo     when the quote returned one
 *   timestampFrom   only sweeps at or after this ISO time. This is what makes
 *                   INCREMENTAL reconciliation possible.
 *   page / limit    limit caps at 50
 *   sortOrder       'desc' newest first, 'asc' oldest first
 *
 * THE RECONCILIATION PATTERN
 *   Store the timestamp of the last sweep you processed. Next run, pass it as
 *   timestampFrom with sortOrder 'asc' and process forward. Never re-scan
 *   from the beginning: it gets slower every day and risks double-crediting.
 *
 * BEST PRACTICE
 *   Make the processing step idempotent on the sweep's txHash. Overlapping
 *   runs and retries then cannot double-credit a user.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/04-status/04-any-input-withdrawals.ts <depositAddress> [memo]
 */
import { OneClickClient, classifyError } from '../../src';

async function main(): Promise<void> {
  const [depositAddress, memo] = process.argv.slice(2);

  if (!depositAddress) {
    console.log('Usage: npx ts-node examples/04-status/04-any-input-withdrawals.ts <depositAddress> [memo]');
    console.log('\nCreate a collection address first with 02-quotes/04-any-input.ts (needs ONE_CLICK_JWT).');
    console.log('\nWhy this and not GET /v0/status:');
    console.log('  ANY_INPUT never reaches SUCCESS. Polling for it never returns.');
    return;
  }

  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  try {
    // Newest first: "what happened recently".
    const recent = await client.getAnyInputWithdrawals({
      depositAddress,
      depositMemo: memo,
      page: 1,
      limit: 50,
      sortOrder: 'desc',
    });

    const sweeps = recent.withdrawals ?? [];
    console.log(`${sweeps.length} sweep(s) on this page, ${recent.total ?? 'unknown'} total\n`);
    for (const sweep of sweeps.slice(0, 10)) {
      console.log(`  ${sweep.timestamp}  ${sweep.amountOutFormatted ?? sweep.amountOut}  ${sweep.txHash ?? ''}`);
    }

    if (sweeps.length === 0) {
      console.log('  Nothing swept yet. Deposits pool until roughly $1,000 USD, then convert.');
      return;
    }

    // The incremental pattern. In a real job, `checkpoint` comes from your
    // database and is written back only after processing succeeds.
    const checkpoint = sweeps[sweeps.length - 1].timestamp;
    console.log(`\nIncremental run from checkpoint ${checkpoint}:`);

    const since = await client.getAnyInputWithdrawals({
      depositAddress,
      depositMemo: memo,
      timestampFrom: checkpoint,
      sortOrder: 'asc', // forward in time, so processing order is deterministic
      limit: 50,
    });

    const processed = new Set<string>(); // idempotency guard, keyed by txHash
    for (const sweep of since.withdrawals ?? []) {
      const key = sweep.txHash ?? `${sweep.timestamp}:${sweep.amountOut}`;
      if (processed.has(key)) continue; // already credited, skip
      processed.add(key);
      console.log(`  credit ${sweep.amountOutFormatted ?? sweep.amountOut} (${key})`);
    }
    console.log(`\nProcessed ${processed.size} unique sweep(s). Persist the last timestamp as the new checkpoint.`);
  } catch (error) {
    const advice = classifyError(error);
    console.error(`\n${advice.kind}: ${error instanceof Error ? error.message : error}`);
    if (advice.kind === 'NOT_FOUND') {
      console.error('  A 404 here usually means this is not an ANY_INPUT collection address.');
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
