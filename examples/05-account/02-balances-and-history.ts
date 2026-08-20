/**
 * GET /v0/account/balances  and  GET /v0/account/history
 *
 * Both are scoped to ONE account and both need that account's User-Session
 * accessToken, not your partner JWT. Balances are private; your integrator
 * credential does not grant access to them.
 *
 * balances  [{ assetId, balance }] in smallest units. What the account holds
 *           inside Intents right now.
 * history   that account's own past swaps.
 *
 * DO NOT CONFUSE history WITH THE EXPLORER API
 *   GET /v0/account/history   one account's swaps, authorized by that user
 *   Explorer GET /transactions  YOUR swaps as an integrator, across all users,
 *                               authorized by your partner JWT
 *   Different scope, different credential, different use case. See 07-explorer.
 *
 * WHY CHECK BALANCES
 *   Before quoting a depositType INTENTS swap, confirm the account can
 *   actually fund it. 1Click accepts the quote either way, and the swap then
 *   sits unfunded until the deadline. Checking first turns a silent stall
 *   into an immediate, explainable error.
 *
 *   For an unauthenticated version of the same check, read the contract
 *   directly: see 08-intents-contract/01-balances-and-nonces.ts. That needs
 *   no user token at all, which makes it the better choice for a pre-quote
 *   guard in a backend.
 *
 * AUTH  USER_ACCESS_TOKEN from 05-account/01.
 * RUN   USER_ACCESS_TOKEN=... npx ts-node examples/05-account/02-balances-and-history.ts
 */
import { OneClickClient, classifyError, formatAmount } from '../../src';

async function main(): Promise<void> {
  const accessToken = process.env.USER_ACCESS_TOKEN;
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  if (!accessToken) {
    console.log('USER_ACCESS_TOKEN is not set.');
    console.log('\nGet one by running 05-account/01-authenticate-and-refresh.ts with a real');
    console.log('wallet signature, then:');
    console.log('  USER_ACCESS_TOKEN=<accessToken> npx ts-node examples/05-account/02-balances-and-history.ts');
    console.log('\nWhat these calls look like:');
    console.log('  const balances = await client.getBalances(accessToken);');
    console.log('  const history  = await client.getHistory(accessToken, { page: 1, limit: 20 });');
    console.log('\nNote the partner JWT is NOT accepted here, however valid it is.');
    return;
  }

  const tokens = await client.getTokens();
  const decimalsOf = (assetId: string): number | undefined => tokens.find((t) => t.assetId === assetId)?.decimals;

  try {
    const balances = await client.getBalances(accessToken);
    console.log(`${balances.length} asset(s) held inside Intents:\n`);

    for (const entry of balances) {
      const decimals = decimalsOf(entry.assetId);
      const symbol = tokens.find((t) => t.assetId === entry.assetId)?.symbol ?? entry.assetId;
      // Format only for display; keep the raw value for any comparison.
      const human = decimals === undefined ? entry.balance : formatAmount(entry.balance, decimals);
      console.log(`  ${symbol.padEnd(10)} ${human.padStart(24)}   (${entry.balance} raw)`);
    }

    // The pre-quote guard, in BigInt.
    const wnear = balances.find((b) => b.assetId === 'nep141:wrap.near');
    if (wnear) {
      const needed = BigInt('1000000000000000000000000'); // 1 wNEAR
      console.log(`\nCan fund a 1 wNEAR INTENTS swap? ${BigInt(wnear.balance) >= needed}`);
    }
  } catch (error) {
    const advice = classifyError(error);
    console.error(`\nbalances failed: ${advice.kind} ${error instanceof Error ? error.message.slice(0, 120) : ''}`);
    if (advice.kind === 'AUTH') {
      console.error('  The token is expired or is a partner JWT rather than a user token.');
      console.error('  Refresh it: await client.refresh(refreshToken)');
    }
  }

  try {
    const history = await client.getHistory(accessToken, { page: 1, limit: 10 });
    console.log(`\n${history.length} past swap(s) for this account:`);
    for (const entry of history.slice(0, 10)) {
      console.log(
        `  ${entry.createdAt ?? '?'}  ${entry.status ?? '?'}  ${entry.originAsset} -> ${entry.destinationAsset}`,
      );
    }
  } catch (error) {
    console.error(`\nhistory failed: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
