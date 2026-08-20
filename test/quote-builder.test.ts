import { TokenInfo } from '../src/types/one-click';
import { buildQuoteRequest } from '../src/utils/quote-builder';
import { TokenRegistry } from '../src/utils/token-registry';

const WNEAR = 'nep141:wrap.near';
const USDT = 'nep141:usdt.tether-token.near';

const registry = new TokenRegistry([
  { assetId: WNEAR, decimals: 24, blockchain: 'near', symbol: 'wNEAR', price: 5, priceUpdatedAt: '' },
  { assetId: USDT, decimals: 6, blockchain: 'near', symbol: 'USDT', price: 1, priceUpdatedAt: '' },
] as TokenInfo[]);

const base = {
  from: WNEAR,
  to: USDT,
  recipient: 'user.near',
  recipientType: 'INTENTS' as const,
  depositType: 'INTENTS' as const,
};

describe('buildQuoteRequest', () => {
  it('converts a human amount with the origin decimals for EXACT_INPUT', () => {
    const request = buildQuoteRequest({ ...base, swapType: 'EXACT_INPUT', amount: '1', human: true }, registry);
    expect(request.amount).toBe('1000000000000000000000000'); // 1 wNEAR, 24 decimals
  });

  // The bug this module exists to make impossible.
  it('converts a human amount with the DESTINATION decimals for EXACT_OUTPUT', () => {
    const request = buildQuoteRequest({ ...base, swapType: 'EXACT_OUTPUT', amount: '10', human: true }, registry);
    expect(request.amount).toBe('10000000'); // 10 USDT, 6 decimals
  });

  it('passes smallest units through untouched without human', () => {
    const request = buildQuoteRequest({ ...base, swapType: 'EXACT_INPUT', amount: '12345' }, registry);
    expect(request.amount).toBe('12345');
  });

  it('normalizes ANY_INPUT to its fixed originAsset and amount', () => {
    const request = buildQuoteRequest({ ...base, swapType: 'ANY_INPUT', amount: '999' });
    expect(request.originAsset).toBe('1cs_v1:any');
    expect(request.amount).toBe('0');
  });

  it('refuses to build a request the matrix rejects', () => {
    // ANY_INPUT has no on-chain deposit path.
    expect(() =>
      buildQuoteRequest({ ...base, swapType: 'ANY_INPUT', depositType: 'ORIGIN_CHAIN', amount: '0' }),
    ).toThrow(/not supported for ANY_INPUT/);
  });

  it('defaults refunds back to where the deposit came from', () => {
    const fromChain = buildQuoteRequest({
      ...base,
      depositType: 'ORIGIN_CHAIN',
      swapType: 'EXACT_INPUT',
      amount: '1000',
    });
    expect(fromChain.refundType).toBe('ORIGIN_CHAIN');

    const fromIntents = buildQuoteRequest({ ...base, swapType: 'EXACT_INPUT', amount: '1000' });
    expect(fromIntents.refundType).toBe('INTENTS');
    expect(fromIntents.refundTo).toBe('user.near');
  });

  it('defaults to a dry request, so nothing commits by accident', () => {
    expect(buildQuoteRequest({ ...base, swapType: 'EXACT_INPUT', amount: '1000' }).dry).toBe(true);
    expect(buildQuoteRequest({ ...base, swapType: 'EXACT_INPUT', amount: '1000', dry: false }).dry).toBe(false);
  });

  it('needs a registry only when converting human amounts', () => {
    expect(() => buildQuoteRequest({ ...base, swapType: 'EXACT_INPUT', amount: '1', human: true })).toThrow(
      /TokenRegistry is required/,
    );
  });

  it('sets a future deadline', () => {
    const request = buildQuoteRequest({ ...base, swapType: 'EXACT_INPUT', amount: '1000', deadlineMs: 60_000 });
    expect(Date.parse(request.deadline)).toBeGreaterThan(Date.now());
  });
});

describe('TokenRegistry', () => {
  it('resolves decimals per asset', () => {
    expect(registry.decimalsOf(WNEAR)).toBe(24);
    expect(registry.decimalsOf(USDT)).toBe(6);
  });

  it('round-trips amounts', () => {
    expect(registry.format(registry.parse('1.5', USDT), USDT)).toBe('1.5');
  });

  it('fails loudly on an unknown asset', () => {
    expect(() => registry.require('nep141:nope.near')).toThrow(/Unknown assetId/);
  });

  it('returns every match for a symbol, since symbols are not unique', () => {
    expect(registry.bySymbol('usdt')).toHaveLength(1);
    expect(registry.onChain('near')).toHaveLength(2);
  });
});
