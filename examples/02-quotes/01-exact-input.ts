/**
 * POST /v0/quote  ...  swapType: EXACT_INPUT
 *
 * "I am sending exactly this much. Tell me what I get."
 * The default choice, and the right one for wallet swaps and bridges.
 *
 * HOW THE VARIABLES BEHAVE FOR THIS TYPE
 *   amount             ORIGIN token units. 1 wNEAR -> parse with wNEAR decimals.
 *   slippageTolerance  bounds the OUTPUT. The input is fixed, so slippage can
 *                      only move what you receive.
 *   amountIn           what you must send. Fixed.
 *   minAmountOut       the floor on what you receive. This is the number to
 *                      show a user as a guarantee, not amountOut.
 *   depositType        ORIGIN_CHAIN | INTENTS | CONFIDENTIAL_INTENTS
 *
 * DEPOSIT BEHAVIOR
 *   below amountIn  -> refunded to refundTo by the deadline
 *   exactly         -> swaps
 *   above           -> swaps, and the excess is refunded
 *
 * BEST PRACTICE
 *   Quote with dry:true first. It is free, commits to nothing, and validates
 *   the whole request. Only set dry:false when the user has confirmed.
 *
 * AUTH  none required. ONE_CLICK_JWT removes the 0.2% platform fee.
 * RUN   npx ts-node examples/02-quotes/01-exact-input.ts
 */
import { OneClickClient, QuoteRequest, formatAmount, parseAmount, verifyQuote } from '../../src';

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  const usdt = tokens.find((t) => t.assetId === 'nep141:usdt.tether-token.near');
  if (!wnear || !usdt) throw new Error('Expected assets not listed');

  // The full request, written out. Every field is required except the ones
  // marked optional in QuoteRequest.
  const request: QuoteRequest = {
    dry: true, // simulate: no deposit address, no commitment
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100, // basis points, so 1%

    originAsset: wnear.assetId,
    depositType: 'INTENTS', // funds already inside Intents
    // EXACT_INPUT counts in the ORIGIN token, so use wNEAR's decimals.
    amount: parseAmount('1', wnear.decimals),

    destinationAsset: usdt.assetId,
    recipient: 'example.near',
    recipientType: 'INTENTS',

    refundTo: 'example.near',
    refundType: 'INTENTS',

    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  const quote = await client.getQuote(request);

  // Always verify before trusting anything in the response, especially a
  // deposit address. See 02-quotes/07-verify-signature.ts.
  if (!verifyQuote(quote)) throw new Error('Quote signature invalid, refusing to use it');

  console.log(`correlationId: ${quote.correlationId}\n`);
  console.log(`send    ${quote.quote.amountInFormatted} wNEAR   <- fixed by you`);
  console.log(`receive ${quote.quote.amountOutFormatted} USDT   <- estimate, moves with the market`);
  console.log(`floor   ${formatAmount(quote.quote.minAmountOut, usdt.decimals)} USDT   <- guaranteed after slippage`);
  console.log(`\nestimated time: ${quote.quote.timeEstimate}s`);
  console.log(`deposit address: ${quote.quote.depositAddress ?? 'none (dry run)'}`);

  // slippageTolerance only moves the floor for this swap type.
  const loose = await client.getQuote({ ...request, slippageTolerance: 500 });
  console.log(`\nslippage 1%: floor ${formatAmount(quote.quote.minAmountOut, usdt.decimals)} USDT`);
  console.log(`slippage 5%: floor ${formatAmount(loose.quote.minAmountOut, usdt.decimals)} USDT`);
  console.log('  amountIn is identical in both. Only the guarantee changed.');
  console.log('  Tighter slippage = better guarantee, but more swaps fail in volatile markets.');

  console.log('\nTo commit, re-quote with dry:false. That allocates a real deposit address.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
