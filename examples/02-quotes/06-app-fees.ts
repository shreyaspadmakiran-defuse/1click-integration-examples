/**
 * appFees and referral: charging for your integration.
 *
 * FIELD SHAPE
 *   appFees: [{ recipient: string, fee: number }]
 *   fee is basis points, 100 = 1.00%. Repeatable; entries aggregate.
 *
 * HOW THE FEE IS ACTUALLY APPLIED
 *   1. Cap is 500 bps (5%). Anything higher is rejected.
 *   2. A 50/50 revenue share applies BY DEFAULT. Half of `fee` reaches your
 *      recipient, half goes to 1Click. Setting fee:100 (1%) earns you 50 bps,
 *      not 100. Size your fee accordingly.
 *   3. Where the fee comes from depends on swapType:
 *        EXACT_INPUT   deducted from the input before swapping.
 *                      net_in = amount_in * (1 - fee/10000)
 *        EXACT_OUTPUT  ADDED to the required input, since the output is fixed.
 *                      net_in = min_amount_in * (1 + fee/10000)
 *        FLEX_INPUT    deducted proportionally from whatever is deposited.
 *
 * SEPARATE FROM THE PLATFORM FEE
 *   Without a ONE_CLICK_JWT, a 0.2% platform fee applies on top of any
 *   appFees. The JWT removes that. They are independent.
 *
 * BEST PRACTICE
 *   Always quote WITH your fees applied. Quoting without them and adding the
 *   fee later shows the user a number they will not receive.
 *
 * AUTH  none required, but ONE_CLICK_JWT removes the extra 0.2%.
 * RUN   npx ts-node examples/02-quotes/06-app-fees.ts
 */
import { OneClickClient, QuoteRequest, formatAmount, parseAmount, quoteRequestErrors } from '../../src';

const FEE_RECIPIENT = 'example.near';

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  const usdt = tokens.find((t) => t.assetId === 'nep141:usdt.tether-token.near');
  if (!wnear || !usdt) throw new Error('Expected assets not listed');

  const base: QuoteRequest = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: wnear.assetId,
    depositType: 'INTENTS',
    amount: parseAmount('100', wnear.decimals),
    destinationAsset: usdt.assetId,
    recipient: 'example.near',
    recipientType: 'INTENTS',
    refundTo: 'example.near',
    refundType: 'INTENTS',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  // EXACT_INPUT: the fee comes out of the output the user receives.
  const noFee = await client.getQuote(base);
  const withFee = await client.getQuote({
    ...base,
    appFees: [{ recipient: FEE_RECIPIENT, fee: 100 }], // 1.00%
    referral: 'my-app', // analytics tag, costs nothing
  });

  console.log('EXACT_INPUT, 100 wNEAR in, 1% appFee:');
  console.log(`  without fee: ${noFee.quote.amountOutFormatted} USDT out`);
  console.log(`  with fee:    ${withFee.quote.amountOutFormatted} USDT out`);
  console.log(`  input sent:  ${withFee.quote.amountInFormatted} wNEAR (unchanged)`);

  const taken = BigInt(noFee.quote.amountOut) - BigInt(withFee.quote.amountOut);
  console.log(`  fee taken:   ${formatAmount(taken.toString(), usdt.decimals)} USDT`);
  console.log(`  of which roughly half reaches ${FEE_RECIPIENT}, half goes to 1Click (50/50 default)`);

  // EXACT_OUTPUT: the output is pinned, so the fee raises the cost instead.
  const exactOutBase: QuoteRequest = {
    ...base,
    swapType: 'EXACT_OUTPUT',
    amount: parseAmount('100', usdt.decimals), // DESTINATION units
  };
  const outNoFee = await client.getQuote(exactOutBase);
  const outWithFee = await client.getQuote({
    ...exactOutBase,
    appFees: [{ recipient: FEE_RECIPIENT, fee: 100 }],
  });

  console.log('\nEXACT_OUTPUT, 100 USDT out, 1% appFee:');
  console.log(`  without fee: costs ${outNoFee.quote.amountInFormatted} wNEAR`);
  console.log(`  with fee:    costs ${outWithFee.quote.amountInFormatted} wNEAR`);
  console.log(`  output:      ${outWithFee.quote.amountOutFormatted} USDT (unchanged)`);
  console.log('  Same fee, opposite side of the trade. The pinned side never moves.');

  // Multiple recipients aggregate.
  const split = await client.getQuote({
    ...base,
    appFees: [
      { recipient: FEE_RECIPIENT, fee: 50 },
      { recipient: 'partner.near', fee: 25 },
    ],
  });
  console.log(`\nTwo fee entries (50 + 25 bps): ${split.quote.amountOutFormatted} USDT out`);

  // The cap, checked locally.
  const errors = quoteRequestErrors({ ...base, appFees: [{ recipient: FEE_RECIPIENT, fee: 600 }] });
  console.log(`\n600 bps rejected locally: ${errors[0]}`);

  console.log(`\nPartner JWT set: ${Boolean(process.env.ONE_CLICK_JWT)}`);
  console.log('  Without it, add 0.2% platform fee on top of everything above.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
