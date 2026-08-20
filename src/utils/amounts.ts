/**
 * BigInt-based helpers for token amounts. The 1Click API always speaks in
 * smallest units (wei, yoctoNEAR, satoshi, ...) as decimal strings.
 */

/** "1.5" with 6 decimals -> "1500000" */
export function parseAmount(human: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(human)) {
    throw new Error(`Invalid amount "${human}", expected a positive decimal number`);
  }
  const [whole, frac = ''] = human.split('.');
  if (frac.length > decimals) {
    throw new Error(`Amount "${human}" has more fractional digits than the token's ${decimals} decimals`);
  }
  const scaled = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  return scaled.toString();
}

/** "1500000" with 6 decimals -> "1.5" */
export function formatAmount(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid raw amount "${raw}", expected an integer string`);
  }
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}
