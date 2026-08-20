/**
 * Testing YOUR integration, without a testnet and without spending anything.
 *
 * Because there is no NEAR Intents testnet, an automated test suite has to
 * run against something you control. MockOneClickClient is that: the same
 * interface, in-memory state, fully deterministic.
 *
 * WHAT TO TEST WITH IT
 *   - your state machine handles every status, not just SUCCESS
 *   - you persist the deposit address before funds move
 *   - REFUNDED and FAILED are handled, and surfaced to the user
 *   - retries do not double-submit
 *   - memo chains work (the 404 you would otherwise meet in production)
 *   - your code survives 5xx, timeouts, and rate limits
 *
 * WHAT NOT TO TEST WITH IT
 *   Pricing, solver behavior, and signature verification. Mock quotes carry a
 *   placeholder signature that verifyQuote() correctly rejects. That is
 *   deliberate: do not disable verification to make a test pass.
 *
 * This file is written as assertions so it doubles as a template for your own
 * test suite. Drop the bodies into Jest or Vitest as-is.
 *
 * AUTH  none. Fully offline.
 * RUN   npx ts-node examples/11-testing/01-testing-your-integration.ts
 */
import * as assert from 'assert';
import {
  ApiError,
  MockOneClickClient,
  OneClickClient,
  OrderStore,
  QuoteRequest,
  SwapOrder,
  pollUntilSettled,
  submitIntentSafely,
} from '../../src';

/** Stand-in for your database. */
class MemoryStore implements OrderStore {
  private readonly rows = new Map<string, SwapOrder>();
  list(): SwapOrder[] {
    return [...this.rows.values()];
  }
  get(depositAddress: string): SwapOrder | undefined {
    return this.rows.get(depositAddress);
  }
  save(order: Partial<SwapOrder> & { depositAddress: string }): SwapOrder {
    const now = new Date().toISOString();
    const saved = {
      correlationId: '',
      createdAt: now,
      ...this.rows.get(order.depositAddress),
      ...order,
      updatedAt: now,
    } as SwapOrder;
    this.rows.set(order.depositAddress, saved);
    return saved;
  }
}

/**
 * The code under test: a tiny version of what your service does. Written
 * against OneClickClient, so the mock substitutes for free.
 */
async function startSwap(client: OneClickClient, store: OrderStore, request: QuoteRequest): Promise<string> {
  const quote = await client.getQuote({ ...request, dry: false });
  const depositAddress = quote.quote.depositAddress;
  if (!depositAddress) throw new Error('No deposit address returned');

  // The ordering that matters: persist BEFORE telling anyone to send funds.
  store.save({
    depositAddress,
    depositMemo: quote.quote.depositMemo,
    correlationId: quote.correlationId,
    status: 'PENDING_DEPOSIT',
  });
  return depositAddress;
}

const baseRequest: QuoteRequest = {
  dry: true,
  swapType: 'EXACT_INPUT',
  slippageTolerance: 100,
  originAsset: 'nep141:wrap.near',
  depositType: 'ORIGIN_CHAIN',
  amount: '1000000000000000000000000',
  destinationAsset: 'nep141:usdt.tether-token.near',
  recipient: 'example.near',
  recipientType: 'INTENTS',
  refundTo: 'example.near',
  refundType: 'ORIGIN_CHAIN',
  deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
};

const tests: Array<[string, () => Promise<void>]> = [
  [
    'persists the deposit address before funds can move',
    async () => {
      const client = new MockOneClickClient();
      const store = new MemoryStore();
      const address = await startSwap(client, store, baseRequest);

      assert.ok(store.get(address), 'order must exist immediately after quoting');
      assert.strictEqual(store.get(address)?.status, 'PENDING_DEPOSIT');
    },
  ],
  [
    'reaches SUCCESS on the happy path',
    async () => {
      const client = new MockOneClickClient();
      const store = new MemoryStore();
      const address = await startSwap(client, store, baseRequest);

      const final = await pollUntilSettled(client, address, { intervalMs: 1 });
      assert.strictEqual(final.status, 'SUCCESS');
      assert.ok(final.swapDetails?.amountOut, 'a successful swap reports amountOut');
    },
  ],
  [
    'handles REFUNDED, which you cannot trigger on demand in production',
    async () => {
      const client = new MockOneClickClient({
        statusSequence: ['PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT', 'REFUNDED'],
      });
      const store = new MemoryStore();
      const address = await startSwap(client, store, baseRequest);

      const final = await pollUntilSettled(client, address, { intervalMs: 1 });
      assert.strictEqual(final.status, 'REFUNDED');
      assert.ok(final.swapDetails?.refundedAmount, 'a refund reports the amount returned');
      // The assertion most teams forget: REFUNDED is terminal but NOT success.
      assert.notStrictEqual(final.status, 'SUCCESS');
    },
  ],
  [
    'handles FAILED',
    async () => {
      const client = new MockOneClickClient({ statusSequence: ['PENDING_DEPOSIT', 'PROCESSING', 'FAILED'] });
      const store = new MemoryStore();
      const address = await startSwap(client, store, baseRequest);

      const final = await pollUntilSettled(client, address, { intervalMs: 1 });
      assert.strictEqual(final.status, 'FAILED');
    },
  ],
  [
    'requires depositMemo on memo chains, and 404s without it',
    async () => {
      const client = new MockOneClickClient();
      const quote = await client.getQuote({
        ...baseRequest,
        dry: false,
        originAsset: 'nep141:xlm.omft.near', // stellar: a memo chain
        depositType: 'ORIGIN_CHAIN',
      });
      const address = quote.quote.depositAddress as string;
      assert.ok(quote.quote.depositMemo, 'memo chains return a depositMemo');

      // Forgetting the memo looks exactly like "swap does not exist".
      await assert.rejects(
        () => client.getStatus(address),
        (error: unknown) => error instanceof ApiError && error.status === 404,
      );
      // With it, the lookup works.
      const status = await client.getStatus(address, quote.quote.depositMemo);
      assert.ok(status.status);
    },
  ],
  [
    'does not resubmit an intent that already landed',
    async () => {
      const client = new MockOneClickClient({ statusSequence: ['PROCESSING'] });
      await client.getQuote({ ...baseRequest, dry: false, depositType: 'INTENTS' });
      const address = [...client.swaps.keys()][0];
      // Pretend a first submission landed but the response was lost.
      const swap = client.swaps.get(address);
      if (swap) swap.intentHash = 'intent-already-landed';

      client.failNext('submitIntent', new Error('The operation timed out'));
      const result = await submitIntentSafely(
        client,
        { type: 'swap_transfer', signedData: { standard: 'nep413', payload: {}, signature: 'x' } },
        address,
      );

      assert.strictEqual(result.recovered, true, 'must recover, not resubmit');
      assert.strictEqual(result.intentHash, 'intent-already-landed');
      assert.strictEqual(
        client.calls.filter((call) => call === 'submitIntent').length,
        1,
        'exactly one submit attempt',
      );
    },
  ],
  [
    'surfaces a rejected request instead of retrying it forever',
    async () => {
      const client = new MockOneClickClient();
      // The matrix is enforced here too, so a test cannot pass against the
      // mock and then fail in production.
      await assert.rejects(
        () => client.getQuote({ ...baseRequest, swapType: 'FLEX_INPUT', depositType: 'CONFIDENTIAL_INTENTS' }),
        (error: unknown) => error instanceof ApiError && error.status === 400,
      );
    },
  ],
  [
    'survives a transient 5xx on a retryable call',
    async () => {
      const client = new MockOneClickClient();
      client.failNext('getTokens');
      await assert.rejects(() => client.getTokens());
      // The queued failure is consumed, so the next call succeeds.
      const tokens = await client.getTokens();
      assert.ok(tokens.length > 0);
    },
  ],
];

async function main(): Promise<void> {
  let passed = 0;
  let failed = 0;

  for (const [name, run] of tests) {
    try {
      await run();
      console.log(`  PASS  ${name}`);
      passed++;
    } catch (error) {
      console.log(`  FAIL  ${name}`);
      console.log(`        ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log('\nEvery one of these ran offline, deterministically, and spent nothing.');
  console.log('Copy the bodies into Jest or Vitest; the mock needs no special setup.');
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
