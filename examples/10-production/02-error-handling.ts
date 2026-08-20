/**
 * Error handling: the rule that keeps an integration correct under failure.
 *
 * After a failed call there is exactly one question worth asking: what am I
 * allowed to do next? Three answers.
 *
 *   RETRYABLE   send the identical request again. Safe.
 *   AMBIGUOUS   it MAY have been applied. Never resend a write. Read server
 *               state and decide from what you find.
 *   TERMINAL    the server decided. Retrying changes nothing; fix the request.
 *
 * THE DISTINCTION IS ABOUT THE CALL, NOT THE ERROR
 *   A timeout on GET /v0/tokens is retryable: reading twice is harmless.
 *   The same timeout on POST /v0/submit-intent is ambiguous, and retrying it
 *   can submit the same intent twice. Same error, opposite correct response.
 *
 * WHAT THIS REPO RETRIES AUTOMATICALLY
 *   GETs and dry quotes    on 429/5xx/network. Repeating them is harmless.
 *   non-dry quotes         NEVER. A retry allocates a second deposit address.
 *   submit-intent          NEVER. A retry can double-submit.
 *
 * This example triggers real failures against the live API rather than
 * describing them.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/10-production/02-error-handling.ts
 */
import { ApiError, OneClickClient, classifyError, explainError } from '../../src';

async function attempt(label: string, call: () => Promise<unknown>): Promise<void> {
  console.log(`\n${label}`);
  try {
    await call();
    console.log('  succeeded');
  } catch (error) {
    const advice = classifyError(error);
    console.log(`  kind:       ${advice.kind}${advice.status ? ` (HTTP ${advice.status})` : ''}`);
    console.log(`  retryable:  ${advice.retryable}`);
    console.log(`  ambiguous:  ${advice.ambiguous}`);
    console.log(`  what to do: ${advice.hint}`);
  }
}

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  // 404: a deposit address that does not exist.
  await attempt('GET /v0/status with an unknown address', () => client.getStatus('not-a-real-deposit-address'));

  // 400: a request the server rejects outright.
  await attempt('POST /v0/quote with an unsupported asset', () =>
    client.getQuote({
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: 'nep141:does-not-exist.near',
      depositType: 'INTENTS',
      amount: '1000',
      destinationAsset: 'nep141:usdt.tether-token.near',
      recipient: 'example.near',
      recipientType: 'INTENTS',
      refundTo: 'example.near',
      refundType: 'INTENTS',
      deadline: new Date(Date.now() + 600_000).toISOString(),
    }),
  );

  // 401: a partner route without the key.
  await attempt('POST /v0/generate-intent without ONE_CLICK_API_KEY', () =>
    new OneClickClient().generateIntent({
      type: 'swap_transfer',
      standard: 'nep413',
      signerId: 'example.near',
      depositAddress: 'some-address',
    }),
  );

  // Network failure: no response at all, so nothing can be concluded.
  await attempt('an unreachable host', () =>
    new OneClickClient({ baseUrl: 'https://127.0.0.1:9', timeoutMs: 1_500, retries: 0 }).getTokens(),
  );

  // ApiError carries the detail when the classification is not enough.
  console.log('\n--- Reading the details ---');
  try {
    await client.getStatus('not-a-real-deposit-address');
  } catch (error) {
    if (error instanceof ApiError) {
      console.log(`status: ${error.status}`);
      console.log(`url:    ${error.url}`);
      console.log(`body:   ${JSON.stringify(error.body)}`);
    }
    console.log(`\nFor logs, explainError() gives the one-liner plus the next step:\n${explainError(error)}`);
  }

  console.log('\n--- Before retrying any write ---');
  console.log('Ask whether the failure was ambiguous.');
  console.log('If it was, read server state first. See 10-production/03.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
