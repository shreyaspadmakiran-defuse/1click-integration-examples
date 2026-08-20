/**
 * The mock is shipped code that integrators will build their own test suites
 * on, so it needs to behave like the real API in the ways that matter.
 */
import { ApiError } from '../src/client/http';
import { pollUntilSettled } from '../src/flows/poll-status';
import { QuoteRequest } from '../src/types/one-click';
import { MockOneClickClient } from '../src/testing/mock-client';
import { verifyQuote } from '../src/utils/verify-quote';

const request: QuoteRequest = {
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
  deadline: new Date(Date.now() + 600_000).toISOString(),
};

describe('MockOneClickClient', () => {
  it('returns no deposit address for a dry quote, and one for a real quote', async () => {
    const client = new MockOneClickClient();
    expect((await client.getQuote(request)).quote.depositAddress).toBeUndefined();
    expect((await client.getQuote({ ...request, dry: false })).quote.depositAddress).toBeDefined();
  });

  it('enforces the swap-type matrix, so tests cannot pass here and fail in production', async () => {
    const client = new MockOneClickClient();
    await expect(
      client.getQuote({ ...request, swapType: 'FLEX_INPUT', depositType: 'CONFIDENTIAL_INTENTS' }),
    ).rejects.toThrow(ApiError);
  });

  it('rejects a deadline in the past', async () => {
    const client = new MockOneClickClient();
    await expect(client.getQuote({ ...request, deadline: '2020-01-01T00:00:00.000Z' })).rejects.toThrow(/deadline/);
  });

  it('sizes EXACT_OUTPUT from the destination amount', async () => {
    const client = new MockOneClickClient();
    const quote = await client.getQuote({ ...request, swapType: 'EXACT_OUTPUT', amount: '10000000' });
    // amountOut is what was asked for; amountIn is derived.
    expect(quote.quote.amountOut).toBe('10000000');
    expect(quote.quote.amountIn).not.toBe('10000000');
  });

  it('puts the slippage floor on the correct side per swap type', async () => {
    const client = new MockOneClickClient();
    const exactIn = await client.getQuote(request);
    // EXACT_INPUT pins the input, so only the output floor moves.
    expect(exactIn.quote.minAmountIn).toBe(exactIn.quote.amountIn);
    expect(BigInt(exactIn.quote.minAmountOut)).toBeLessThan(BigInt(exactIn.quote.amountOut));

    const exactOut = await client.getQuote({ ...request, swapType: 'EXACT_OUTPUT', amount: '10000000' });
    // EXACT_OUTPUT pins the output, so only the input floor moves.
    expect(exactOut.quote.minAmountOut).toBe(exactOut.quote.amountOut);
    expect(BigInt(exactOut.quote.minAmountIn)).toBeLessThan(BigInt(exactOut.quote.amountIn));
  });

  it('advances through the configured status sequence', async () => {
    const client = new MockOneClickClient({ statusSequence: ['PENDING_DEPOSIT', 'PROCESSING', 'SUCCESS'] });
    const quote = await client.getQuote({ ...request, dry: false });
    const address = quote.quote.depositAddress as string;

    const final = await pollUntilSettled(client, address, { intervalMs: 1 });
    expect(final.status).toBe('SUCCESS');
    expect(final.swapDetails?.amountOut).toBeDefined();
  });

  it('reports a refund without an amountOut', async () => {
    const client = new MockOneClickClient({ statusSequence: ['PENDING_DEPOSIT', 'REFUNDED'] });
    const quote = await client.getQuote({ ...request, dry: false });

    const final = await pollUntilSettled(client, quote.quote.depositAddress as string, { intervalMs: 1 });
    expect(final.status).toBe('REFUNDED');
    expect(final.swapDetails?.refundedAmount).toBeDefined();
    expect(final.swapDetails?.amountOut).toBeUndefined();
  });

  it('404s on an unknown deposit address', async () => {
    const client = new MockOneClickClient();
    await expect(client.getStatus('nope')).rejects.toMatchObject({ status: 404 });
  });

  // Reproduces the memo-chain 404.
  it('404s on a memo chain when the memo is omitted', async () => {
    const client = new MockOneClickClient();
    const quote = await client.getQuote({ ...request, dry: false, originAsset: 'nep141:xlm.omft.near' });
    const address = quote.quote.depositAddress as string;

    expect(quote.quote.depositMemo).toBeDefined();
    await expect(client.getStatus(address)).rejects.toMatchObject({ status: 404 });
    await expect(client.getStatus(address, quote.quote.depositMemo)).resolves.toBeDefined();
  });

  it('injects failures on demand, consuming one per call', async () => {
    const client = new MockOneClickClient();
    client.failNext('getTokens');
    await expect(client.getTokens()).rejects.toBeDefined();
    await expect(client.getTokens()).resolves.toHaveLength(4);
  });

  it('records calls so tests can assert on them', async () => {
    const client = new MockOneClickClient();
    await client.getTokens();
    await client.getQuote(request);
    expect(client.calls).toEqual(['getTokens', 'getQuote']);
  });

  // The mock has no signing key. Hiding that would teach integrators to
  // disable a security check to make tests pass.
  it('produces a quote whose signature does NOT verify', async () => {
    const client = new MockOneClickClient();
    expect(verifyQuote(await client.getQuote(request))).toBe(false);
  });
});
