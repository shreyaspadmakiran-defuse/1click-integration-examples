/**
 * POST /v0/quote  ...  swapType: ANY_INPUT
 *
 * A standing collection address that accepts ANY supported token and
 * periodically converts the pool into one destination asset.
 *
 * This type breaks the model the other three share. There is no trade being
 * priced, so most of the request goes inert:
 *
 *   originAsset        MUST be "1cs_v1:any". You are not naming an input
 *                      token, you are saying "whatever arrives".
 *   amount             MUST be "0". There is nothing to size.
 *   slippageTolerance  IGNORED. No fixed rate exists to slip against; the
 *                      conversion is priced at sweep time.
 *   refundTo/Type      IGNORED. ANY_INPUT never refunds. A failed swap
 *                      retries every 5 minutes instead.
 *   depositType        INTENTS or CONFIDENTIAL_INTENTS only.
 *   deadline           the quote runs indefinitely; no refresh needed.
 *
 * NO TERMINAL STATUS
 *   The swap NEVER reaches a terminal status. Deposits accumulate and sweep
 *   once the pool clears roughly $1,000 USD. Polling GET /v0/status for
 *   SUCCESS will never return. Reconcile with GET /v0/any-input/withdrawals
 *   instead. See 04-status/04-any-input-withdrawals.ts.
 *
 * USE IT FOR  donation addresses, fee aggregation, dust collection: anywhere
 *             you accept many tokens and want one asset out.
 *
 * AUTH  ONE_CLICK_JWT required. The API rejects ANY_INPUT for unauthorized callers.
 * RUN   npx ts-node examples/02-quotes/04-any-input.ts
 */
import { OneClickClient, QuoteRequest, ruleFor, validateQuoteRequest } from '../../src';

async function main(): Promise<void> {
  const rule = ruleFor('ANY_INPUT');
  console.log('ANY_INPUT constraints, from the swap-type matrix:');
  console.log(`  originAsset must be:  ${rule.requiredOriginAsset}`);
  console.log(`  amount must be:       "${rule.requiredAmount}"`);
  console.log(`  depositTypes:         ${rule.depositTypes.join(', ')}`);
  console.log(`  refundable:           ${rule.refundable}`);
  console.log(`  reaches SUCCESS:      ${rule.settlesToTerminalStatus}\n`);

  const request: QuoteRequest = {
    dry: true,
    swapType: 'ANY_INPUT',
    slippageTolerance: 0, // ignored, set to 0 to say so

    originAsset: '1cs_v1:any', // the required sentinel
    depositType: 'INTENTS',
    amount: '0', // required

    destinationAsset: 'nep141:usdt.tether-token.near',
    recipient: 'example.near',
    recipientType: 'INTENTS',

    // Present because the type requires them, but ignored for ANY_INPUT.
    refundTo: 'example.near',
    refundType: 'INTENTS',

    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  // Warnings, not errors: these fields are accepted and then ignored.
  for (const issue of validateQuoteRequest(request)) {
    console.log(`  ${issue.level}: ${issue.message}`);
  }

  if (!process.env.ONE_CLICK_JWT) {
    console.log('\nSet ONE_CLICK_JWT to actually create a collection address.');
    console.log('The API returns 401 "Swap type is not available for unauthorized requests" without it.');
    return;
  }

  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });
  const quote = await client.getQuote({ ...request, dry: false });

  console.log(`\ncollection address: ${quote.quote.depositAddress}`);
  if (quote.quote.depositMemo) console.log(`memo:               ${quote.quote.depositMemo}`);
  console.log('\nSend any supported token there, any number of times.');
  console.log('Then reconcile the sweeps, do NOT poll for a terminal status:');
  console.log(`  client.getAnyInputWithdrawals({ depositAddress: "${quote.quote.depositAddress}" })`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
