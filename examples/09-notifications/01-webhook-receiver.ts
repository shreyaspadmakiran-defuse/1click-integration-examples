/**
 * Receiving status notifications instead of polling.
 *
 * Polling costs one request per swap per interval. Push costs nothing until
 * something changes. The catch is that a notification arrives from outside
 * your trust boundary, and 1Click publishes no payload schema to validate.
 *
 * THE DESIGN
 *   Treat a notification as a HINT about WHICH swap changed. Never as a
 *   statement of WHAT it changed to. Extract the deposit address, then read
 *   GET /v0/status yourself. That one decision buys four properties:
 *
 *     idempotent          the same notification twice is harmless, so
 *                         at-least-once delivery is fine
 *     order-independent   a delayed notification cannot move a swap backwards
 *     spoof-resistant     a forged body cannot inject a fake SUCCESS
 *     schema-independent  it keeps working when the payload changes
 *
 * THE OTHER HALF: STATUS CODES CARRY DELIVERY SEMANTICS
 *   400  unusable payload. Do not retry; retrying cannot help.
 *   200  handled.
 *   500  I could not verify. Please retry.
 *   Returning 200 on an error silently drops the update forever.
 *
 * YOU NEED PRIOR STATE
 *   "Only act on transitions" requires remembering what you already knew.
 *   Without a store every notification looks new and you email the user on
 *   every redelivery. That store is your database.
 *
 * This example runs a real HTTP server and posts four notifications at it,
 * including a hostile one. No network calls leave the machine.
 *
 * AUTH  none (the status read would use your normal client).
 * RUN   npx ts-node examples/09-notifications/01-webhook-receiver.ts
 */
import * as http from 'http';
import { OneClickClient, OrderStore, SwapOrder, extractSwapRef, handleNotificationRequest } from '../../src';

const PORT = 8479;
const KNOWN_ADDRESS = 'demo-deposit-address';

/** Minimal in-memory OrderStore. In production this is a database table. */
class MemoryOrderStore implements OrderStore {
  private readonly orders = new Map<string, SwapOrder>();

  list(): SwapOrder[] {
    return [...this.orders.values()];
  }

  get(depositAddress: string): SwapOrder | undefined {
    return this.orders.get(depositAddress);
  }

  save(order: Partial<SwapOrder> & { depositAddress: string }): SwapOrder {
    const now = new Date().toISOString();
    const existing = this.orders.get(order.depositAddress);
    const saved = { correlationId: '', createdAt: now, ...existing, ...order, updatedAt: now } as SwapOrder;
    this.orders.set(order.depositAddress, saved);
    return saved;
  }
}

/**
 * Stubbed so the example is deterministic and offline. In production this is
 * your ordinary client, and this call IS the security model: authoritative
 * status comes from the API, never from the request body.
 */
function stubClient(): OneClickClient {
  const client = new OneClickClient();
  client.getStatus = async (depositAddress: string) => {
    if (depositAddress !== KNOWN_ADDRESS) throw new Error(`HTTP 404: ${depositAddress} not found`);
    return {
      correlationId: 'c1',
      status: 'PROCESSING', // the truth, whatever the payload claims
      updatedAt: new Date().toISOString(),
      swapDetails: { intentHashes: ['intent-abc'], nearTxHashes: [] },
    } as never;
  };
  return client;
}

function post(body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port: PORT, path: '/webhooks/1click', method: 'POST' },
      (response) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: data }));
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

async function main(): Promise<void> {
  const client = stubClient();
  const store = new MemoryOrderStore();
  const sideEffects: string[] = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid json"}');
        return;
      }

      // The handler.
      const result = await handleNotificationRequest(client, parsed, {
        store,
        // Fires ONLY on a real transition. Safe to send email from here.
        onTransition: (r) => {
          sideEffects.push(`${r.previousStatus ?? 'unknown'} -> ${r.status.status}`);
        },
      });

      res.writeHead(result.statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`POST http://127.0.0.1:${PORT}/webhooks/1click\n`);

  const first = await post({ depositAddress: KNOWN_ADDRESS, status: 'KNOWN_DEPOSIT_TX' });
  console.log(`1. genuine notification    ${first.status}  ${first.body}`);

  const repeat = await post({ depositAddress: KNOWN_ADDRESS, status: 'KNOWN_DEPOSIT_TX' });
  console.log(`2. redelivered             ${repeat.status}  ${repeat.body}`);
  console.log('   changed:false, so no duplicate email and no duplicate fulfillment.');

  const forged = await post({ depositAddress: KNOWN_ADDRESS, status: 'SUCCESS' });
  console.log(`3. forged SUCCESS claim    ${forged.status}  ${forged.body}`);
  console.log('   The body said SUCCESS. The answer is PROCESSING, read from the API.');

  const junk = await post({ hello: 'world' });
  console.log(`4. no deposit address      ${junk.status}  ${junk.body}`);
  console.log('   400, because retrying an unusable payload cannot help.');

  console.log(`\nside effects fired: ${sideEffects.length}  (${sideEffects.join(', ') || 'none'})`);
  console.log('Four notifications about one swap, exactly one side effect.');

  // The extractor is deliberately permissive about envelope shape.
  console.log('\nextractSwapRef() across payload shapes:');
  for (const shape of [
    { depositAddress: 'addr-1' },
    { deposit_address: 'addr-2', deposit_memo: 'memo-2' },
    { data: { depositAddress: 'addr-3', depositMemo: 'memo-3' } },
    { event: { payload: { address: 'addr-4' } } },
    { unrelated: true },
  ]) {
    console.log(`  ${JSON.stringify(shape).padEnd(58)} -> ${JSON.stringify(extractSwapRef(shape))}`);
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
