/**
 * POST /v0/auth/authenticate  and  POST /v0/auth/refresh
 *
 * THE TWO CREDENTIAL SYSTEMS, WHICH ARE INDEPENDENT
 *
 *   PARTNER credentials identify YOU, the integrator:
 *     ONE_CLICK_JWT      Authorization: Bearer. Removes the 0.2% platform fee.
 *     ONE_CLICK_API_KEY  X-API-Key. For generate-intent and submit-intent.
 *
 *   USER-SESSION token identifies the END USER and proves they own an account:
 *     obtained from /v0/auth/authenticate by signing an empty-intents payload
 *     used by  GET /v0/account/balances
 *              GET /v0/account/history
 *              POST /v0/quote when the swap is CONFIDENTIAL
 *     renewed by /v0/auth/refresh, without asking the user to sign again
 *
 * WHERE THE USER TOKEN DOES NOT APPLY
 *   Signed intent execution does NOT use the user token, even though it is
 *   the most user-driven thing in the API. generate-intent and submit-intent
 *   take the PARTNER key; the user's authorization is the wallet signature
 *   inside signedData. Reaching for a session token there means you are on
 *   the wrong path.
 *
 * HOW THE SIGNATURE WORKS
 *   Build a payload with an EMPTY intents array, a deadline, and the signer
 *   id, then have the wallet sign it with NEP-413 (or another supported
 *   standard). Empty intents means the signature proves ownership without
 *   authorizing any state change. It cannot move funds even if intercepted.
 *
 * BEST PRACTICE
 *   Refresh proactively, before expiry. Waiting for a 401 turns a background
 *   token renewal into a user-visible "please sign again" prompt.
 *
 * AUTH  a wallet signature. No partner credentials needed for this route.
 * RUN   npx ts-node examples/05-account/01-authenticate-and-refresh.ts
 */
import { OneClickClient, SignedIntentData, classifyError } from '../../src';

const ACCOUNT = 'example.near';

/**
 * Replace with a real wallet signature over an empty-intents payload.
 * Shown as a literal so the failure below is the authentic API response
 * rather than something fabricated.
 */
function buildSignedAuthPayload(): SignedIntentData {
  const message = JSON.stringify({
    signer_id: ACCOUNT,
    deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
    intents: [], // empty: proves ownership, authorizes nothing
  });

  return {
    standard: 'nep413',
    payload: {
      recipient: 'intents.near',
      nonce: Buffer.alloc(32).toString('base64'),
      message,
    },
    public_key: 'ed25519:<the user public key>',
    signature: 'ed25519:<the wallet signature over that payload>',
  };
}

async function main(): Promise<void> {
  const client = new OneClickClient();

  console.log('Step 1: the wallet signs an empty-intents payload.');
  const signedData = buildSignedAuthPayload();
  console.log(`  standard: ${signedData.standard}`);
  console.log(`  intents:  [] (empty, so this cannot authorize a transfer)\n`);

  let accessToken: string | undefined;
  let refreshToken: string | undefined;

  try {
    const session = await client.authenticate({ signedData });
    accessToken = session.accessToken;
    refreshToken = session.refreshToken;

    console.log('Step 2: authenticated.');
    console.log(`  accessToken expires in  ${session.expiresIn}s`);
    console.log(`  refreshToken valid for  ${session.refreshExpiresIn}s`);
  } catch (error) {
    const advice = classifyError(error);
    console.log(`Step 2: rejected, as expected with a placeholder signature.`);
    console.log(`  ${advice.kind}: ${error instanceof Error ? error.message.slice(0, 140) : error}`);
    console.log('\n  Wire buildSignedAuthPayload() to a real wallet to get a token.');
  }

  console.log('\nStep 3: refresh before expiry, not after.');
  if (!refreshToken) {
    console.log('  const { accessToken, expiresIn } = await client.refresh(refreshToken);');
    console.log('  Schedule this at roughly 80% of expiresIn. No wallet interaction needed.');
  } else {
    const renewed = await client.refresh(refreshToken);
    console.log(`  renewed, expires in ${renewed.expiresIn}s`);
  }

  console.log('\nWhere the token is used:');
  console.log('  client.getBalances(accessToken)                 05-account/02');
  console.log('  client.getHistory(accessToken)                  05-account/02');
  console.log('  client.getQuote(confidentialRequest, accessToken)  03-swaps/03');
  console.log('\nWhere it is NOT used:');
  console.log('  client.generateIntent(...)  and  client.submitIntent(...)');
  console.log('  Those take the partner X-API-Key instead.');

  if (accessToken) {
    console.log(`\nToken acquired for ${ACCOUNT}; pass it to 05-account/02 via USER_ACCESS_TOKEN.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
