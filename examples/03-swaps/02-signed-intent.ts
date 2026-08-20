/**
 * The INTENTS lifecycle: no on-chain deposit, a wallet signature instead.
 *
 * When funds already sit inside Intents there is nothing to wait for on a
 * chain. The user authorizes the swap by signing a message.
 *
 * THE SEQUENCE
 *   1. quote with depositType INTENTS, dry:false
 *   2. POST /v0/generate-intent   -> the exact payload to sign
 *   3. the wallet signs it        -> byte for byte, unmodified
 *   4. POST /v0/submit-intent     -> the signed MultiPayload
 *   5. poll /v0/status
 *
 * AUTH, THE PART PEOPLE GET WRONG
 *   generate-intent and submit-intent use the PARTNER key (X-API-Key). They
 *   do NOT use the end user's User-Session token, even though this is the
 *   most user-driven part of the API. The user's authorization is the wallet
 *   signature inside signedData. If you are reaching for a session token
 *   here, you are on the wrong path.
 *
 * THE SIGNING CONTRACT
 *   Sign the payload EXACTLY as returned. Do not re-serialize it, reorder
 *   keys, or normalize whitespace. The signature must cover the same bytes
 *   the server produced, or submission fails with an invalid signature.
 *
 * NEVER RETRY submit-intent BLINDLY
 *   It is not idempotent. A timeout does not tell you whether it was applied.
 *   submitIntentSafely() recovers by READING status instead. See
 *   10-production/03-idempotency-and-recovery.ts.
 *
 * AUTH  ONE_CLICK_API_KEY required for steps 2 and 4.
 * RUN   npx ts-node examples/03-swaps/02-signed-intent.ts
 */
import {
  OneClickClient,
  QuoteRequest,
  SignedIntentData,
  UnsignedIntent,
  parseAmount,
  pollUntilSettled,
  submitIntentSafely,
  verifyQuote,
} from '../../src';

const SIGNER_ACCOUNT = 'example.near';

/**
 * Your wallet integration goes here. It receives the payload from
 * generate-intent and must return the signature over it unchanged.
 */
async function signWithWallet(intent: UnsignedIntent): Promise<{ publicKey?: string; signature: string }> {
  console.log(`\nStep 3, wallet signs (standard: ${intent.standard}):`);
  console.log(`  ${JSON.stringify(intent.payload).slice(0, 200)}`);
  throw new Error('No wallet connected. Replace signWithWallet() with your signing integration.');
}

async function main(): Promise<void> {
  const client = new OneClickClient({
    jwt: process.env.ONE_CLICK_JWT,
    apiKey: process.env.ONE_CLICK_API_KEY, // sent as X-API-Key
  });

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  if (!wnear) throw new Error('wNEAR not listed');

  const request: QuoteRequest = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: wnear.assetId,
    depositType: 'INTENTS', // funds already inside Intents
    amount: parseAmount('1', wnear.decimals),
    destinationAsset: 'nep141:usdt.tether-token.near',
    recipient: SIGNER_ACCOUNT,
    recipientType: 'INTENTS',
    refundTo: SIGNER_ACCOUNT,
    refundType: 'INTENTS',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  const preview = await client.getQuote(request);
  console.log('Step 1, dry quote:');
  console.log(`  ${preview.quote.amountInFormatted} wNEAR -> ${preview.quote.amountOutFormatted} USDT`);
  console.log('  No deposit address needed: the funds are already in Intents.');

  if (!process.env.ONE_CLICK_API_KEY) {
    console.log('\nSet ONE_CLICK_API_KEY to run steps 2-5 (generate-intent and submit-intent).');
    return;
  }

  // STEP 1 committed. depositAddress here is a correlation handle, not
  // somewhere to send funds.
  const quote = await client.getQuote({ ...request, dry: false });
  if (!verifyQuote(quote)) throw new Error('Quote signature verification failed');
  const depositAddress = quote.quote.depositAddress;
  if (!depositAddress) throw new Error('No depositAddress returned');

  // STEP 2. depositAddress links the intent back to this quote.
  const generated = await client.generateIntent({
    type: 'swap_transfer',
    standard: 'nep413', // erc191, raw_ed25519, webauthn, ton_connect, sep53, tip191
    signerId: SIGNER_ACCOUNT,
    depositAddress,
  });
  console.log(`\nStep 2, generated intent for ${quote.correlationId}`);

  // STEP 3.
  const { publicKey, signature } = await signWithWallet(generated.intent);

  // STEP 4. The MultiPayload is the generated intent plus key and signature.
  const signedData: SignedIntentData = {
    ...generated.intent,
    ...(publicKey ? { public_key: publicKey } : {}),
    signature,
  };
  const submitted = await submitIntentSafely(client, { type: 'swap_transfer', signedData }, depositAddress, {
    depositMemo: quote.quote.depositMemo,
  });
  console.log(`\nStep 4, intent ${submitted.intentHash}${submitted.recovered ? ' (recovered, not resubmitted)' : ''}`);

  // STEP 5.
  const final = await pollUntilSettled(client, depositAddress, {
    depositMemo: quote.quote.depositMemo,
    onUpdate: (status) => console.log(`  ${status.status}`),
  });
  console.log(`\nStep 5, settled: ${final.status}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
