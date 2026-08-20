/**
 * simulate_intents: dry-run a signed intent before submitting it.
 *
 * A view call that executes the intent logic WITHOUT changing state. It is
 * the closest thing to "would this work?" that exists.
 *
 * ARGUMENT
 *   { signed: [ MultiPayload, ... ] }   the same signed payloads you would
 *                                       hand to POST /v0/submit-intent
 *
 * RESPONSE
 *   intents_executed[]  { intent_hash, account_id, nonce } for each intent
 *                       that would run. Note you learn the intent_hash BEFORE
 *                       submitting, so you can record it up front.
 *   logs[]              the DIP-4 events execution would emit
 *   min_deadline        the earliest deadline across the batch
 *   state.fee           current fee in pips (100 pips = 0.01%)
 *   state.current_salt  the salt used in nonce validation
 *
 * WHAT IT CATCHES BEFORE YOU SPEND A SUBMIT
 *   - a malformed or mis-signed payload
 *   - an already-used nonce
 *   - a deadline that has passed
 *   - an intent that would not do what you expected
 *
 * BEST PRACTICE
 *   Simulate in staging and when debugging a rejected submit. Do not put it
 *   in the hot path of every swap: it doubles your latency, and submit-intent
 *   validates the same things anyway. Its value is diagnostic.
 *
 * AUTH  none. Public NEAR RPC.
 * RUN   npx ts-node examples/08-intents-contract/02-simulate-intents.ts
 */
import { IntentsContractClient, SignedIntentData } from '../../src';

const ACCOUNT = 'example.near';

async function main(): Promise<void> {
  const contract = new IntentsContractClient();

  // A structurally correct but unsigned payload. Replace payload/signature
  // with a real generate-intent result plus wallet signature.
  const signed: SignedIntentData = {
    standard: 'nep413',
    payload: {
      recipient: 'intents.near',
      nonce: Buffer.alloc(32).toString('base64'),
      message: JSON.stringify({
        signer_id: ACCOUNT,
        deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
        intents: [
          {
            intent: 'token_diff',
            diff: { 'nep141:wrap.near': '-1000000000000000000000000', 'nep141:usdt.tether-token.near': '1700000' },
          },
        ],
      }),
    },
    public_key: 'ed25519:11111111111111111111111111111111',
    signature: 'ed25519:1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111',
  };

  console.log('Simulating one intent (placeholder signature, so expect a rejection):\n');

  try {
    const result = await contract.simulateIntents([signed]);

    console.log(`would execute ${result.intents_executed.length} intent(s):`);
    for (const intent of result.intents_executed) {
      console.log(`  hash:    ${intent.intent_hash}`);
      console.log(`  signer:  ${intent.account_id}`);
      console.log(`  nonce:   ${intent.nonce}`);
    }
    console.log(`\nmin_deadline: ${result.min_deadline}`);
    console.log(`fee:          ${result.state.fee} pips (${result.state.fee / 10_000}%)`);
    console.log(`current_salt: ${result.state.current_salt}`);
    console.log(`\n${result.logs.length} event(s) would be emitted:`);
    for (const log of result.logs.slice(0, 3)) console.log(`  ${log.slice(0, 120)}`);

    console.log('\nintent_hash is known BEFORE submitting, so record it now and you can');
    console.log('always correlate the submit afterwards, even if the response is lost.');
  } catch (error) {
    // This is the expected path with a placeholder signature, and it is
    // exactly the diagnostic value of simulate_intents.
    console.log(`simulation rejected: ${error instanceof Error ? error.message : error}`);
    console.log('\nThat rejection is the point: the contract told you the payload is bad');
    console.log('without you spending a submit-intent call to find out.');
    console.log('\nTo simulate a real one:');
    console.log('  1. client.generateIntent({ type, standard, signerId, depositAddress })');
    console.log('  2. sign generated.intent with the wallet, unchanged');
    console.log('  3. contract.simulateIntents([{ ...generated.intent, public_key, signature }])');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
