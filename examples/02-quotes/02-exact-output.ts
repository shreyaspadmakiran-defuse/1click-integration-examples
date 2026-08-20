/**
 * POST /v0/quote  ...  swapType: EXACT_OUTPUT
 *
 * "I need exactly this much out. Tell me what it costs."
 * Use it for invoices, fixed-price checkout, and debt repayment: anywhere the
 * output number is the requirement rather than the input.
 *
 * THE ONE VARIABLE THAT CHANGES MEANING
 *   amount   is in DESTINATION token units, not origin.
 *
 *   "10" here means 10 USDT, so it must be parsed with USDT's 6 decimals.
 *   Parsing it with wNEAR's 24 decimals produces a perfectly valid request
 *   that asks for 10^18 times too much. Nothing rejects it. This is the most
 *   common expensive mistake in a 1Click integration.
 *
 * THE OTHER SHIFT
 *   slippageTolerance  bounds the INPUT here, the mirror of EXACT_INPUT.
 *                      The output is fixed, so slippage moves what you pay.
 *   amountIn           the quoted cost
 *   minAmountIn        the REFUND THRESHOLD. Anything at or above this swaps.
 *                      Showing users amountIn as "the amount" works until a
 *                      deposit lands between minAmountIn and amountIn, which
 *                      your code then wrongly treats as underfunded.
 *   amountOut          exactly what you asked for. Guaranteed.
 *
 * BEST PRACTICE
 *   Derive which token `amount` belongs to from swapType rather than assuming
 *   origin. amountAssetId() does this; see src/config/swap-rules.ts.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/02-quotes/02-exact-output.ts
 */
import { OneClickClient, QuoteRequest, amountAssetId, formatAmount, parseAmount } from '../../src';

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  const usdt = tokens.find((t) => t.assetId === 'nep141:usdt.tether-token.near');
  if (!wnear || !usdt) throw new Error('Expected assets not listed');

  // Show both encodings before making the call.
  console.log('Encoding "10" for an EXACT_OUTPUT wNEAR -> USDT swap:');
  console.log(`  correct   (USDT, ${usdt.decimals} dp):  ${parseAmount('10', usdt.decimals)}`);
  console.log(`  incorrect (wNEAR, ${wnear.decimals} dp): ${parseAmount('10', wnear.decimals)}`);
  console.log('  Both are valid requests. Only the first asks for 10 USDT.\n');

  const request: QuoteRequest = {
    dry: true,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: 100,

    originAsset: wnear.assetId,
    depositType: 'INTENTS',
    // DESTINATION decimals, because this swap type counts what you receive.
    amount: parseAmount('10', usdt.decimals),

    destinationAsset: usdt.assetId,
    recipient: 'example.near',
    recipientType: 'INTENTS',

    refundTo: 'example.near',
    refundType: 'INTENTS',

    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  // Rather than remembering the rule, ask for it.
  console.log(`amountAssetId() says amount belongs to: ${amountAssetId(request)}\n`);

  const quote = await client.getQuote(request);

  console.log(`receive exactly ${quote.quote.amountOutFormatted} USDT   <- fixed by you`);
  console.log(`quoted cost     ${quote.quote.amountInFormatted} wNEAR`);
  console.log(`refund floor    ${formatAmount(quote.quote.minAmountIn, wnear.decimals)} wNEAR   <- minAmountIn`);

  // The gap between minAmountIn and amountIn is live slippage headroom.
  const headroom = BigInt(quote.quote.amountIn) - BigInt(quote.quote.minAmountIn);
  console.log(`\nheadroom: ${formatAmount(headroom.toString(), wnear.decimals)} wNEAR`);
  console.log(`  deposit >= ${quote.quote.minAmountIn}  -> swaps`);
  console.log(`  deposit <  ${quote.quote.minAmountIn}  -> refunded to ${request.refundTo}`);
  console.log('  A deposit inside the headroom is NOT underfunded. Compare against minAmountIn.');

  // Slippage moves the cost, not the payout, for this swap type.
  const loose = await client.getQuote({ ...request, slippageTolerance: 500 });
  console.log(
    `\nslippage 1%: pay up to ${quote.quote.amountInFormatted}, floor ${formatAmount(
      quote.quote.minAmountIn,
      wnear.decimals,
    )}`,
  );
  console.log(
    `slippage 5%: pay up to ${loose.quote.amountInFormatted}, floor ${formatAmount(
      loose.quote.minAmountIn,
      wnear.decimals,
    )}`,
  );
  console.log(`  amountOut is ${loose.quote.amountOutFormatted} in both. The output never moves.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
