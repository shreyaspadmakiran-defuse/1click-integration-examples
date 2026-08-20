/**
 * Waiting for a swap to settle, correctly.
 *
 * THE FOUR RULES OF POLLING
 *   1. Have an overall timeout. A loop with no deadline is a hung request or
 *      a leaked worker. Allow up to 15 minutes for cross-chain processing.
 *   2. Emit only on TRANSITIONS. Firing a callback on every poll means
 *      emailing the user every 5 seconds.
 *   3. Stop at a terminal status: SUCCESS, REFUNDED, or FAILED.
 *   4. A timeout is not a failure of the SWAP, only of your wait. The swap
 *      continues. Resume by polling the same address later.
 *
 * ANY_INPUT IS THE EXCEPTION
 *   It never reaches a terminal status by design, so polling always times
 *   out. pollUntilSettled() detects this from the swapType in the response
 *   and warns rather than letting you wonder. Use the withdrawals endpoint
 *   instead: see 04-status/04-any-input-withdrawals.ts.
 *
 * BETTER THAN POLLING
 *   If you can receive webhooks, do: see 09-notifications. Polling costs a
 *   request per swap per interval; push costs nothing until something moves.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/04-status/02-poll-until-settled.ts <depositAddress> [memo]
 */
import { ExecutionStatus, OneClickClient, TERMINAL_STATUSES, pollUntilSettled } from '../../src';

async function main(): Promise<void> {
  const [depositAddress, memo] = process.argv.slice(2);

  if (!depositAddress) {
    console.log('Usage: npx ts-node examples/04-status/02-poll-until-settled.ts <depositAddress> [memo]');
    console.log('\nThe helper this demonstrates:');
    console.log('  await pollUntilSettled(client, depositAddress, {');
    console.log('    depositMemo,');
    console.log('    intervalMs: 5_000,');
    console.log('    timeoutMs: 15 * 60_000,');
    console.log('    onUpdate: (status) => console.log(status.status),  // transitions only');
    console.log('  });');
    return;
  }

  const client = new OneClickClient();

  try {
    const final = await pollUntilSettled(client, depositAddress, {
      depositMemo: memo,
      intervalMs: 5_000,
      // Rule 1. Cross-chain processing can take up to 15 minutes.
      timeoutMs: 15 * 60_000,
      // Rule 2. Called only when the status actually changed.
      onUpdate: (status: ExecutionStatus) => {
        console.log(`  ${new Date().toISOString()}  ${status.status}`);
      },
    });

    // Rule 3. Terminal, but terminal does not mean successful.
    console.log(`\nsettled: ${final.status}`);
    if (final.status === 'SUCCESS') {
      console.log(`  delivered ${final.swapDetails?.amountOutFormatted ?? 'unknown amount'}`);
    } else if (final.status === 'REFUNDED') {
      console.log(`  refunded ${final.swapDetails?.refundedAmountFormatted ?? 'unknown amount'}`);
      console.log(`  to ${final.quoteResponse?.quoteRequest?.refundTo}`);
      console.log('  Usually means the deposit was below the funding floor, or the deadline passed.');
    } else {
      console.log('  FAILED is terminal. Check swapDetails and contact support with the correlationId.');
    }
  } catch (error) {
    // Rule 4.
    console.log(`\nstopped waiting: ${error instanceof Error ? error.message : error}`);
    console.log('The swap itself is unaffected and may still settle.');
    console.log(`Resume any time:  npx ts-node examples/04-status/01-get-status.ts ${depositAddress}`);
    console.log(`Terminal statuses to look for: ${TERMINAL_STATUSES.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
