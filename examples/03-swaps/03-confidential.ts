/**
 * CONFIDENTIAL_INTENTS: the signed-intent path, with privacy.
 *
 * WHAT DIFFERS FROM PLAIN INTENTS
 *   - For confidential balances this is the REQUIRED path, not a speed
 *     optimization. There is no RPC route into a confidential balance, so an
 *     on-chain deposit cannot reach one.
 *   - FLEX_INPUT is not supported. The other three swap types are.
 *   - `confidentiality` selects the level: public | basic | advanced.
 *   - recipientType and refundType can independently be CONFIDENTIAL_INTENTS,
 *     so you can move from a public balance into a confidential one, or back.
 *
 * AUTH IS SPLIT ACROSS STEPS
 *   POST /v0/quote          needs the END USER'S User-Session token. Pricing
 *                           a confidential swap reads a private balance, so
 *                           the partner JWT alone returns 401. Pass it as the
 *                           second argument to getQuote().
 *   POST /v0/generate-intent
 *   POST /v0/submit-intent  need the PARTNER X-API-Key. They do NOT take the
 *                           user token; the wallet signature authorizes them.
 *
 *   So a confidential swap needs BOTH credentials, at different steps. A
 *   public INTENTS swap needs only the partner key.
 *
 * AUTH  USER_ACCESS_TOKEN for quoting, ONE_CLICK_API_KEY for executing.
 * RUN   npx ts-node examples/03-swaps/03-confidential.ts
 */
import {
  OneClickClient,
  QuoteRequest,
  SWAP_TYPE_RULES,
  SwapType,
  classifyError,
  parseAmount,
  ruleFor,
} from '../../src';

const ACCOUNT = 'example.near';

async function main(): Promise<void> {
  const client = new OneClickClient({
    jwt: process.env.ONE_CLICK_JWT,
    apiKey: process.env.ONE_CLICK_API_KEY,
  });

  // Which swap types accept confidential deposits at all.
  console.log('CONFIDENTIAL_INTENTS support by swap type:');
  for (const swapType of Object.keys(SWAP_TYPE_RULES) as SwapType[]) {
    const supported = ruleFor(swapType).depositTypes.includes('CONFIDENTIAL_INTENTS');
    console.log(`  ${swapType.padEnd(13)} ${supported ? 'yes' : 'no'}`);
  }

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  if (!wnear) throw new Error('wNEAR not listed');

  const request: QuoteRequest = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: wnear.assetId,
    depositType: 'CONFIDENTIAL_INTENTS',
    amount: parseAmount('1', wnear.decimals),
    destinationAsset: 'nep141:usdt.tether-token.near',
    recipient: ACCOUNT,
    recipientType: 'CONFIDENTIAL_INTENTS',
    refundTo: ACCOUNT,
    refundType: 'CONFIDENTIAL_INTENTS',
    confidentiality: 'basic', // public | basic | advanced
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  console.log(`\nrequesting: ${request.depositType} -> ${request.recipientType}`);
  console.log(`confidentiality: ${request.confidentiality}`);

  // The user token belongs HERE, on the quote. Obtain it via authenticate();
  // see 05-account/01-authenticate-refresh.ts.
  const userAccessToken = process.env.USER_ACCESS_TOKEN;

  try {
    const quote = await client.getQuote(request, userAccessToken);
    console.log(`\nquoted: ${quote.quote.amountInFormatted} -> ${quote.quote.amountOutFormatted}`);
    console.log('Execution from here is identical to 03-swaps/02-signed-intent.ts:');
    console.log('  generate-intent -> wallet signs -> submit-intent -> poll');
    console.log('Those three use the PARTNER key, not the user token.');
  } catch (error) {
    const advice = classifyError(error);
    console.log(`\nquote failed: ${advice.kind} ${advice.status ?? ''}`);
    console.log(`  ${error instanceof Error ? error.message.slice(0, 160) : error}`);

    if (advice.kind === 'AUTH' && !userAccessToken) {
      console.log('\nThis 401 IS the split-auth rule:');
      console.log('  A confidential quote reads a private balance, so it needs the USER token.');
      console.log('  const session = await client.authenticate({ signedData });');
      console.log('  const quote = await client.getQuote(request, session.accessToken);');
      console.log('\nNote the partner JWT does not help here, no matter how valid it is.');
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
