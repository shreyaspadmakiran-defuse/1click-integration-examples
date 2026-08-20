/**
 * POST /v0/deposit/submit
 *
 * Tell 1Click your deposit transaction instead of waiting for it to be
 * discovered. Optional, nearly free, and it noticeably shortens
 * PENDING_DEPOSIT on slow or congested origin chains.
 *
 * PARAMETERS
 *   depositAddress     from the quote
 *   txHash             the transaction you broadcast
 *   memo               required when the quote returned a depositMemo
 *   nearSenderAccount  required ONLY when a relayer submitted the deposit on
 *                      a NEAR account's behalf. In that case the transaction
 *                      signer is the relayer, not the depositor, so 1Click
 *                      cannot infer who actually paid without being told.
 *
 * It returns the current ExecutionStatus, so it doubles as a status read.
 *
 * SAFELY REPEATABLE
 *   Reporting the same hash twice is harmless, so unlike submit-intent this
 *   one can be retried on a transient failure. It is also purely an
 *   accelerator: if it fails permanently, 1Click still discovers the deposit
 *   on its own. Never block a swap on this call succeeding.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/04-status/03-submit-deposit-tx.ts <depositAddress> <txHash> [memo]
 */
import { OneClickClient, classifyError } from '../../src';

async function main(): Promise<void> {
  const [depositAddress, txHash, memo] = process.argv.slice(2);

  if (!depositAddress || !txHash) {
    console.log('Usage: npx ts-node examples/04-status/03-submit-deposit-tx.ts <depositAddress> <txHash> [memo]');
    console.log('\nWhere it fits:');
    console.log('  1. quote with dry:false     -> depositAddress');
    console.log('  2. broadcast your deposit   -> txHash');
    console.log('  3. THIS CALL                -> faster detection');
    console.log('  4. poll GET /v0/status      -> as normal');
    console.log('\nRelayed NEAR deposits also need nearSenderAccount:');
    console.log('  client.submitDepositTx({ depositAddress, txHash, nearSenderAccount: "user.near" })');
    return;
  }

  const client = new OneClickClient();

  try {
    const status = await client.submitDepositTx({
      depositAddress,
      txHash,
      memo,
      nearSenderAccount: process.env.NEAR_SENDER_ACCOUNT,
    });
    console.log(`accepted. status is now ${status.status}`);
  } catch (error) {
    const advice = classifyError(error);
    console.error(`\n${advice.kind}: ${error instanceof Error ? error.message : error}`);
    console.error(`  ${advice.hint}`);

    if (advice.retryable) {
      console.error('\nRetryable, and this call is safely repeatable, so just try again.');
    } else {
      console.error('\nDefinitive. Check the hash, the address, and the memo if the quote had one.');
    }
    // This call only accelerates detection; it is never required.
    console.error('Either way the deposit is unaffected. 1Click will still find it.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
