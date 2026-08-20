import { formatAmount, parseAmount } from '../src/utils/amounts';

describe('parseAmount', () => {
  it('scales whole numbers', () => {
    expect(parseAmount('1', 24)).toBe('1000000000000000000000000');
  });

  it('scales fractional numbers', () => {
    expect(parseAmount('1.5', 6)).toBe('1500000');
    expect(parseAmount('0.000001', 6)).toBe('1');
  });

  it('rejects too many fractional digits', () => {
    expect(() => parseAmount('1.1234567', 6)).toThrow(/fractional digits/);
  });

  it('rejects garbage', () => {
    expect(() => parseAmount('abc', 6)).toThrow(/Invalid amount/);
    expect(() => parseAmount('-1', 6)).toThrow(/Invalid amount/);
  });
});

describe('formatAmount', () => {
  it('formats down to human units', () => {
    expect(formatAmount('1500000', 6)).toBe('1.5');
    expect(formatAmount('1000000000000000000000000', 24)).toBe('1');
    expect(formatAmount('1', 6)).toBe('0.000001');
  });

  it('round-trips with parseAmount', () => {
    expect(parseAmount(formatAmount('123456789', 8), 8)).toBe('123456789');
  });

  it('rejects non-integer input', () => {
    expect(() => formatAmount('1.5', 6)).toThrow(/Invalid raw amount/);
  });
});
