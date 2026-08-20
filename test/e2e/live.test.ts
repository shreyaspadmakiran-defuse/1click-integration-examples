/**
 * Live end-to-end checks against the real 1Click API.
 * Safe by design: only public GETs and dry quotes, no funds move,
 * no deposit addresses are generated.
 *
 * Run with: npm run test:e2e
 * Skipped entirely unless RUN_LIVE=1.
 */
import { OneClickClient } from '../../src/client/one-click-client';
import { ShieldClient } from '../../src/client/shield-client';
import { loadEnv } from '../../src/config/env';
import { verifyQuote } from '../../src/utils/verify-quote';

const live = process.env.RUN_LIVE === '1' ? describe : describe.skip;

live('1Click API (live, read-only)', () => {
  const env = loadEnv();
  const client = new OneClickClient({ baseUrl: env.oneClickBaseUrl, jwt: env.oneClickJwt });

  jest.setTimeout(60_000);

  it('lists tokens with wNEAR present', async () => {
    const tokens = await client.getTokens();
    expect(tokens.length).toBeGreaterThan(10);
    const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
    expect(wnear).toBeDefined();
    expect(wnear?.decimals).toBe(24);
  });

  it('returns a signed dry quote for wNEAR to USDT', async () => {
    const quote = await client.getQuote({
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: 'nep141:wrap.near',
      depositType: 'INTENTS',
      destinationAsset: 'nep141:usdt.tether-token.near',
      amount: '1000000000000000000000000',
      recipient: 'example.near',
      recipientType: 'INTENTS',
      refundTo: 'example.near',
      refundType: 'INTENTS',
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    });

    expect(quote.quote.amountOut).toBeDefined();
    expect(BigInt(quote.quote.amountOut)).toBeGreaterThan(0n);
    expect(quote.quote.depositAddress).toBeUndefined(); // dry quotes never allocate one
    expect(verifyQuote(quote)).toBe(true);
  });

  it('404s on an unknown deposit address', async () => {
    await expect(client.getStatus('definitely-not-a-real-deposit-address')).rejects.toMatchObject({ status: 404 });
  });
});

live('Shield API (live, read-only)', () => {
  const env = loadEnv();
  const maybe = env.shieldToken ? it : it.skip;

  maybe('reports operational status or active incidents', async () => {
    const shield = new ShieldClient({ baseUrl: env.shieldBaseUrl, token: env.shieldToken as string });
    const status = await shield.getIncidents();
    expect(['operational', 'incidents']).toContain(status.status);
  });
});
