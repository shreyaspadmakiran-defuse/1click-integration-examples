/**
 * These tests are the documentation for the swap-type matrix: each one states
 * a rule that a caller has to get right, and fails if the code drifts from it.
 */
import {
  amountAssetId,
  quoteGuarantees,
  quoteRequestErrors,
  ruleFor,
  SWAP_TYPE_RULES,
  validateQuoteRequest,
} from '../src/config/swap-rules';
import { QuoteRequest, QuoteResponse, SwapType } from '../src/types/one-click';

function request(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: 'nep141:wrap.near',
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: 'nep141:usdt.tether-token.near',
    amount: '1000000000000000000000000',
    recipient: 'user.near',
    recipientType: 'INTENTS',
    refundTo: 'user.near',
    refundType: 'ORIGIN_CHAIN',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    ...overrides,
  };
}

describe('amount denomination', () => {
  it('counts EXACT_INPUT and FLEX_INPUT in the origin asset', () => {
    for (const swapType of ['EXACT_INPUT', 'FLEX_INPUT'] as SwapType[]) {
      expect(amountAssetId(request({ swapType }))).toBe('nep141:wrap.near');
    }
  });

  // The bug this prevents: converting "10 USDT" with wNEAR's 24 decimals.
  it('counts EXACT_OUTPUT in the destination asset', () => {
    expect(amountAssetId(request({ swapType: 'EXACT_OUTPUT' }))).toBe('nep141:usdt.tether-token.near');
  });

  it('has no amount asset for ANY_INPUT', () => {
    expect(amountAssetId(request({ swapType: 'ANY_INPUT', originAsset: '1cs_v1:any' }))).toBeUndefined();
  });
});

describe('depositType compatibility', () => {
  it('accepts FLEX_INPUT over every depositType', () => {
    for (const depositType of ['ORIGIN_CHAIN', 'INTENTS', 'CONFIDENTIAL_INTENTS'] as const) {
      expect(quoteRequestErrors(request({ swapType: 'FLEX_INPUT', depositType }))).toHaveLength(0);
    }
  });

  it('rejects ANY_INPUT over ORIGIN_CHAIN, since there is no on-chain deposit path', () => {
    const errors = quoteRequestErrors(
      request({ swapType: 'ANY_INPUT', depositType: 'ORIGIN_CHAIN', originAsset: '1cs_v1:any', amount: '0' }),
    );
    expect(errors.join(' ')).toContain('not supported for ANY_INPUT');
  });

  it('allows CONFIDENTIAL_INTENTS for every swap type', () => {
    for (const rule of Object.values(SWAP_TYPE_RULES)) {
      expect(rule.depositTypes).toContain('CONFIDENTIAL_INTENTS');
    }
  });
});

describe('ANY_INPUT shape', () => {
  it('requires the 1cs_v1:any origin asset and a zero amount', () => {
    const errors = quoteRequestErrors(request({ swapType: 'ANY_INPUT', depositType: 'INTENTS' }));
    expect(errors.join(' ')).toContain('requires originAsset "1cs_v1:any"');
    expect(errors.join(' ')).toContain('requires amount "0"');
  });

  it('warns that refundTo is ignored, because failures retry instead', () => {
    const issues = validateQuoteRequest(
      request({ swapType: 'ANY_INPUT', depositType: 'INTENTS', originAsset: '1cs_v1:any', amount: '0' }),
    );
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
    expect(issues.some((i) => i.level === 'warning' && i.message.includes('never refunded'))).toBe(true);
  });

  it('never reaches a terminal status', () => {
    expect(ruleFor('ANY_INPUT').settlesToTerminalStatus).toBe(false);
    for (const swapType of ['EXACT_INPUT', 'EXACT_OUTPUT', 'FLEX_INPUT'] as SwapType[]) {
      expect(ruleFor(swapType).settlesToTerminalStatus).toBe(true);
    }
  });
});

describe('generic request validation', () => {
  it('rejects a deadline in the past', () => {
    const errors = quoteRequestErrors(request({ deadline: '2020-01-01T00:00:00.000Z' }));
    expect(errors.join(' ')).toContain('in the past');
  });

  it('rejects a zero or non-integer amount', () => {
    expect(quoteRequestErrors(request({ amount: '0' })).join(' ')).toContain('greater than zero');
    expect(quoteRequestErrors(request({ amount: '1.5' })).join(' ')).toContain('integer string');
  });

  it('rejects slippage outside 0..10000 bps', () => {
    expect(quoteRequestErrors(request({ slippageTolerance: -1 })).join(' ')).toContain('non-negative');
    expect(quoteRequestErrors(request({ slippageTolerance: 10_001 })).join(' ')).toContain('exceeds 10000');
  });

  // appFees cap at 500 bps (5%), well below the slippage ceiling.
  it('rejects app fees outside 1..500 bps', () => {
    expect(quoteRequestErrors(request({ appFees: [{ recipient: 'fees.near', fee: 0 }] })).join(' ')).toContain(
      'between 1 and 500',
    );
    expect(quoteRequestErrors(request({ appFees: [{ recipient: 'fees.near', fee: 501 }] })).join(' ')).toContain(
      'between 1 and 500',
    );
    expect(quoteRequestErrors(request({ appFees: [{ recipient: 'fees.near', fee: 500 }] }))).toHaveLength(0);
  });

  it('requires an app fee recipient', () => {
    expect(quoteRequestErrors(request({ appFees: [{ recipient: '', fee: 30 }] })).join(' ')).toContain('recipient');
  });
});

describe('quoteGuarantees', () => {
  function response(swapType: SwapType): QuoteResponse {
    return {
      correlationId: 'c1',
      timestamp: '',
      signature: '',
      quoteRequest: request({ swapType }),
      quote: {
        amountIn: '1000',
        amountInFormatted: '1',
        amountInUsd: '1',
        minAmountIn: '900',
        amountOut: '2000',
        amountOutFormatted: '2',
        amountOutUsd: '2',
        minAmountOut: '1800',
        timeEstimate: 10,
      },
    };
  }

  it('uses amountIn as the funding floor for EXACT_INPUT', () => {
    expect(quoteGuarantees(response('EXACT_INPUT')).fundAtLeast).toBe('1000');
  });

  // Sending amountIn here is fine, but the refund threshold is minAmountIn.
  it('uses minAmountIn as the funding floor for EXACT_OUTPUT and FLEX_INPUT', () => {
    expect(quoteGuarantees(response('EXACT_OUTPUT')).fundAtLeast).toBe('900');
    expect(quoteGuarantees(response('FLEX_INPUT')).fundAtLeast).toBe('900');
  });

  it('guarantees the exact output for EXACT_OUTPUT and the slippage floor otherwise', () => {
    expect(quoteGuarantees(response('EXACT_OUTPUT')).receiveAtLeast).toBe('2000');
    expect(quoteGuarantees(response('EXACT_INPUT')).receiveAtLeast).toBe('1800');
    expect(quoteGuarantees(response('FLEX_INPUT')).receiveAtLeast).toBe('1800');
  });

  it('promises nothing for ANY_INPUT, which prices at sweep time', () => {
    const g = quoteGuarantees(response('ANY_INPUT'));
    expect(g.fundAtLeast).toBeUndefined();
    expect(g.receiveAtLeast).toBeUndefined();
    expect(g.refundable).toBe(false);
    expect(g.notes.join(' ')).toContain('never finish');
  });
});
