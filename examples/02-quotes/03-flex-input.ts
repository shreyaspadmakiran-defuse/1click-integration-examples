/**
 * POST /v0/quote  ...  swapType: FLEX_INPUT
 *
 * "I will send roughly this much." A band rather than a number.
 *
 * WHY IT EXISTS
 *   EXACT_INPUT refunds a deposit that is one wei short. That is correct when
 *   you control the deposit exactly, and painful when you do not: a user
 *   typing an amount into their own wallet, a sweep from an exchange, or a
 *   gas-adjusted send will all miss by a little. FLEX_INPUT accepts them.
 *
 * HOW THE VARIABLES BEHAVE
 *   amount        ORIGIN units, but a reference point rather than a promise
 *   minAmountIn   the real floor. Anything at or above this swaps.
 *   minAmountOut  the payout floor, since the input can vary too
 *   depositType   all three are accepted.
 *
 * Both floors matter here, unlike the EXACT types where one side is pinned.
 *
 * BEST PRACTICE
 *   Compare deposits against minAmountIn, not amountIn. Treating the quoted
 *   amount as the minimum rejects deposits the API would happily swap.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/02-quotes/03-flex-input.ts
 */
import { OneClickClient, QuoteRequest, formatAmount, parseAmount, ruleFor } from '../../src';

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  const usdt = tokens.find((t) => t.assetId === 'nep141:usdt.tether-token.near');
  if (!wnear || !usdt) throw new Error('Expected assets not listed');

  const request: QuoteRequest = {
    dry: true,
    swapType: 'FLEX_INPUT',
    slippageTolerance: 100,

    originAsset: wnear.assetId,
    depositType: 'INTENTS',
    amount: parseAmount('1', wnear.decimals), // reference, not a requirement

    destinationAsset: usdt.assetId,
    recipient: 'example.near',
    recipientType: 'INTENTS',

    refundTo: 'example.near',
    refundType: 'INTENTS',

    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  const quote = await client.getQuote(request);

  const floorIn = formatAmount(quote.quote.minAmountIn, wnear.decimals);
  const floorOut = formatAmount(quote.quote.minAmountOut, usdt.decimals);
  console.log(`reference amount: ${quote.quote.amountInFormatted} wNEAR`);
  console.log(`accepted from:    ${floorIn} wNEAR upward   <- minAmountIn`);
  console.log(`payout floor:     ${floorOut} USDT          <- minAmountOut`);
  console.log(`\nSend ${floorIn} wNEAR or more and it swaps. You receive at least ${floorOut} USDT.`);
  console.log('Send more than the reference and that swaps too; nothing is refunded for being over.');

  // Contrast with EXACT_INPUT on the identical numbers.
  const exact = await client.getQuote({ ...request, swapType: 'EXACT_INPUT' });
  console.log(`\nEXACT_INPUT on the same amount would require exactly ${exact.quote.amountIn}`);
  console.log(`FLEX_INPUT accepts anything from  ${quote.quote.minAmountIn}`);
  console.log('  FLEX_INPUT accepts the gap between those two numbers; EXACT_INPUT refunds it.');

  console.log(`\nFLEX_INPUT supports depositType: ${ruleFor('FLEX_INPUT').depositTypes.join(', ')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
