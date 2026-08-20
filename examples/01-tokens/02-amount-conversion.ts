/**
 * Amounts: smallest units, BigInt, and the right token's decimals.
 *
 * Every amount in the 1Click API is a string of smallest units. There are no
 * decimal points on the wire. Converting to and from human units is entirely
 * your responsibility, and there are exactly two ways to get it wrong.
 *
 * MISTAKE 1  using floats
 *   A JS number holds ~15-16 significant digits. NEAR has 24 decimals, so
 *   1.5 * 10**24 is not exact. The result is a wrong transfer amount, not a
 *   display rounding issue.
 *
 * MISTAKE 2  using the wrong token's decimals
 *   Which token `amount` refers to depends on swapType. EXACT_OUTPUT counts
 *   in the DESTINATION token. See 02-quotes/02-exact-output.ts.
 *
 * BEST PRACTICE
 *   Do all arithmetic in BigInt on smallest units. Convert to human units
 *   only at the display edge, never in the middle of a calculation.
 *
 * AUTH  none.
 * RUN   npx ts-node examples/01-tokens/02-amount-conversion.ts
 */
import { formatAmount, OneClickClient, parseAmount } from '../../src';

const WNEAR = 'nep141:wrap.near';
const USDT = 'nep141:usdt.tether-token.near';

async function main(): Promise<void> {
  const client = new OneClickClient();
  const tokens = await client.getTokens();

  // Always resolve decimals from the API, never from memory.
  const decimalsOf = (assetId: string): number => {
    const token = tokens.find((t) => t.assetId === assetId);
    if (!token) throw new Error(`Unknown assetId ${assetId}`);
    return token.decimals;
  };

  const wnearDecimals = decimalsOf(WNEAR);
  const usdtDecimals = decimalsOf(USDT);
  console.log(`wNEAR: ${wnearDecimals} decimals, USDT: ${usdtDecimals} decimals\n`);

  // Human -> smallest units -> human, exactly.
  const raw = parseAmount('1.5', wnearDecimals);
  console.log(`parseAmount("1.5", ${wnearDecimals})  = ${raw}`);
  console.log(`formatAmount(that, ${wnearDecimals})  = ${formatAmount(raw, wnearDecimals)}`);

  // Mistake 1, made visible.
  const viaFloat = (1.5 * 10 ** wnearDecimals).toString();
  console.log(`\nvia float:  ${viaFloat}`);
  console.log(`via BigInt: ${raw}`);
  console.log(`identical?  ${viaFloat === raw}`);
  console.log('  The float version is not even an integer string; it is exponential notation.');

  // Mistake 2, made visible. Same input string, 10^18 apart.
  console.log(`\n"10" with wNEAR decimals: ${parseAmount('10', wnearDecimals)}`);
  console.log(`"10" with USDT decimals:  ${parseAmount('10', usdtDecimals)}`);

  // Arithmetic stays in BigInt. This is how you compare a deposit to a floor.
  const quotedIn = parseAmount('5.83', wnearDecimals);
  const minIn = parseAmount('5.77', wnearDecimals);
  const userDeposited = parseAmount('5.80', wnearDecimals);
  console.log(`\nuser deposited ${formatAmount(userDeposited, wnearDecimals)} wNEAR`);
  console.log(`  above the minimum (${formatAmount(minIn, wnearDecimals)})? ${BigInt(userDeposited) >= BigInt(minIn)}`);
  console.log(
    `  equals the quote  (${formatAmount(quotedIn, wnearDecimals)})? ${BigInt(userDeposited) === BigInt(quotedIn)}`,
  );
  console.log('  Below the quote but above the minimum still swaps. Compare against the minimum.');

  // parseAmount refuses precision the token cannot hold, rather than
  // truncating it silently and sending a different amount than displayed.
  try {
    parseAmount('1.1234567', usdtDecimals);
  } catch (error) {
    console.log(`\nRejected instead of truncated: ${(error as Error).message}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
