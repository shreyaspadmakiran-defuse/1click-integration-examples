/**
 * The two failure modes that actually lose money.
 *
 * FAILURE 1: DOUBLE SUBMISSION
 *   POST /v0/submit-intent is not idempotent. A timeout tells you nothing
 *   about whether the server processed it. Retrying can execute twice.
 *
 *   The fix is to recover through a READ, not a retry:
 *     4xx          definitive rejection. Rethrow; a retry cannot help.
 *     timeout/5xx  ambiguous. Check /v0/status FIRST. If an intent hash is
 *                  recorded, or the swap moved past PENDING_DEPOSIT, the
 *                  first submission landed. Only resubmit when the swap is
 *                  provably still waiting.
 *
 *   Stronger still: check the NONCE on intents.near. Nonces are single-use,
 *   so a used nonce is proof of execution, and unlike status it cannot lag.
 *   See 08-intents-contract/01-balances-and-nonces.ts.
 *
 * FAILURE 2: A LOST DEPOSIT ADDRESS
 *   The deposit address is the ONLY key that reconstructs a swap. If your
 *   process dies between "quote with dry:false" and writing it down, and the
 *   user has already sent funds, the swap is unreachable: you cannot show
 *   status, cannot reconcile, cannot help support find it.
 *
 *   The fix is ordering: persist BEFORE funds move, not after.
 *
 * This example simulates all three submit outcomes against a stubbed client,
 * so nothing moves and nothing is left behind.
 *
 * AUTH  none. Fully offline.
 * RUN   npx ts-node examples/10-production/03-idempotency-and-recovery.ts
 */
import { ApiError, OneClickClient, SubmitIntentRequest, submitIntentSafely } from '../../src';

const DEPOSIT_ADDRESS = 'demo-deposit-address';

const request: SubmitIntentRequest = {
  type: 'swap_transfer',
  signedData: { standard: 'nep413', payload: {}, signature: 'ed25519:demo' },
};

/** Builds a client whose submit fails and whose status reports `status`. */
function stubClient(
  submit: () => Promise<never> | Promise<{ intentHash: string; correlationId: string }>,
  status: string,
  intentHashes: string[] = [],
): OneClickClient {
  const client = new OneClickClient();
  client.submitIntent = submit as OneClickClient['submitIntent'];
  client.getStatus = async () =>
    ({
      correlationId: 'c1',
      status,
      updatedAt: new Date().toISOString(),
      swapDetails: { intentHashes, nearTxHashes: [] },
    } as never);
  return client;
}

async function main(): Promise<void> {
  // CASE 1: the submit timed out, but it HAD landed.
  // This is the case that double-spends if you retry blindly.
  {
    const client = stubClient(
      async () => {
        throw new Error('The operation timed out');
      },
      'PROCESSING',
      ['intent-hash-abc'],
    );

    const result = await submitIntentSafely(client, request, DEPOSIT_ADDRESS);
    console.log('CASE 1  timeout, but status shows it landed');
    console.log(`  recovered:  ${result.recovered}`);
    console.log(`  intentHash: ${result.intentHash}`);
    console.log('  No second submission was sent, so the intent executed once.\n');
  }

  // CASE 2: the submit genuinely never arrived, so retrying is correct.
  {
    let attempts = 0;
    const client = stubClient(async () => {
      attempts++;
      if (attempts === 1) throw new Error('socket hang up');
      return { intentHash: 'intent-hash-def', correlationId: 'c2' };
    }, 'PENDING_DEPOSIT');

    const result = await submitIntentSafely(client, request, DEPOSIT_ADDRESS, { retryDelayMs: 1 });
    console.log('CASE 2  failed, and status still shows PENDING_DEPOSIT');
    console.log(`  attempts:   ${attempts}`);
    console.log(`  recovered:  ${result.recovered}`);
    console.log(`  intentHash: ${result.intentHash}`);
    console.log('  Still waiting means it never arrived, so resubmitting is safe.\n');
  }

  // CASE 3: a 4xx is the server deciding. No status check, no retry.
  {
    const client = stubClient(async () => {
      throw new ApiError('https://1click.chaindefuser.com/v0/submit-intent', 400, { message: 'invalid signature' });
    }, 'PENDING_DEPOSIT');

    let rethrown = false;
    try {
      await submitIntentSafely(client, request, DEPOSIT_ADDRESS);
    } catch (error) {
      rethrown = error instanceof ApiError && error.status === 400;
    }
    console.log('CASE 3  400 invalid signature');
    console.log(`  rethrown unchanged: ${rethrown}`);
    console.log('  A definitive rejection needs a corrected request, not a retry.\n');
  }

  // FAILURE 2: the ordering that prevents an unreachable swap.
  console.log('PERSISTENCE ORDERING');
  console.log('  WRONG:  quote(dry:false) -> user sends funds -> save to database');
  console.log('  RIGHT:  quote(dry:false) -> save to database -> user sends funds');
  console.log('\n  Save at minimum:');
  console.log('    depositAddress   the primary key; nothing else can find the swap');
  console.log('    depositMemo      or /v0/status returns 404 on memo chains');
  console.log('    correlationId    what support will ask you for');
  console.log('\n  A crash between the quote and the write, after funds move, is unrecoverable.');
  console.log('  Nothing can recover that swap: no status lookup, no support ticket.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
