/**
 * Verifying the quote signature. Do this on every quote, without exception.
 *
 * WHY IT MATTERS
 *   Every quote response carries an Ed25519 `signature` from 1Click over the
 *   quote payload. The payload contains `depositAddress`: the address your
 *   user is about to send real funds to.
 *
 *   If a response is tampered with in transit, or by a compromised proxy, or
 *   by anything between you and the API, the deposit address can be swapped
 *   for an attacker's. Verifying the signature is what makes that detectable.
 *   Nothing else in the flow will catch it.
 *
 * WHEN
 *   Before you display, store, or send funds to a deposit address. In this
 *   repo, startOriginChainSwap() refuses to return an unverified address at
 *   all, which is the pattern to copy.
 *
 * BEST PRACTICE
 *   Treat a failed verification as fatal, never as a warning to log. There is
 *   no benign reason for a quote signature not to verify.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/02-quotes/07-verify-signature.ts
 */
import { OneClickClient, QuoteRequest, parseAmount, verifyQuote } from '../../src';

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  if (!wnear) throw new Error('wNEAR not listed');

  const request: QuoteRequest = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: wnear.assetId,
    depositType: 'INTENTS',
    amount: parseAmount('1', wnear.decimals),
    destinationAsset: 'nep141:usdt.tether-token.near',
    recipient: 'example.near',
    recipientType: 'INTENTS',
    refundTo: 'example.near',
    refundType: 'INTENTS',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  const quote = await client.getQuote(request);

  console.log(`signature: ${quote.signature.slice(0, 48)}...`);
  console.log(`verifies:  ${verifyQuote(quote)}`);

  // This is the whole pattern. Fatal, not a warning.
  if (!verifyQuote(quote)) {
    throw new Error('Quote signature verification failed, refusing to use the deposit address');
  }
  console.log('\nOnly past this line is quote.quote.depositAddress safe to use.');

  // What tampering looks like. Mutating any signed field breaks the signature.
  console.log('\nTampering detection:');

  const swappedAddress = {
    ...quote,
    quote: { ...quote.quote, depositAddress: 'attacker-controlled-address' },
  };
  console.log(`  deposit address swapped: verifies = ${verifyQuote(swappedAddress)}`);

  const inflatedOutput = {
    ...quote,
    quote: { ...quote.quote, amountOut: '999999999999' },
  };
  console.log(`  amountOut inflated:      verifies = ${verifyQuote(inflatedOutput)}`);

  const movedDeadline = {
    ...quote,
    quote: { ...quote.quote, deadline: new Date(Date.now() + 86_400_000).toISOString() },
  };
  console.log(`  deadline extended:       verifies = ${verifyQuote(movedDeadline)}`);

  console.log("\nForging any of these requires 1Click's private key.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
