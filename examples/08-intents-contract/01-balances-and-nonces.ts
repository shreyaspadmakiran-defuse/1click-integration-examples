/**
 * Reading intents.near directly, over public NEAR RPC.
 *
 * 1Click reports what it believes. The contract holds what is true. These are
 * view calls: no keys, no gas, no state change, no credentials.
 *
 * mt_batch_balance_of(account_id, token_ids) -> string[]
 *   Balances in smallest units, index-aligned with token_ids. Token ids are
 *   1Click assetIds verbatim ("nep141:wrap.near"), so no mapping is needed.
 *
 *   Prefer the batch form over one call per token: it is a single round trip
 *   at a single block height, so the numbers are mutually consistent. Looping
 *   over single calls can straddle a block and return a set of balances that
 *   never simultaneously existed.
 *
 * is_nonce_used(account_id, nonce) -> boolean
 *   Nonces are single-use. A used nonce is PROOF the intent executed.
 *
 *   This is the strongest available answer after an ambiguous submit-intent.
 *   Swap status lags and is derived; the nonce is the contract's own record.
 *
 * WHY THIS BEATS /v0/account/balances FOR A BACKEND GUARD
 *   That endpoint needs the end user's session token. This needs nothing. For
 *   a pre-quote "can they actually fund it" check in your own service, this
 *   is the practical choice.
 *
 * AUTH  none. Public NEAR RPC.
 * RUN   npx ts-node examples/08-intents-contract/01-balances-and-nonces.ts [accountId]
 */
import { IntentsContractClient, OneClickClient, formatAmount } from '../../src';

async function main(): Promise<void> {
  const accountId = process.argv[2] ?? 'example.near';

  const contract = new IntentsContractClient();
  const client = new OneClickClient();
  const tokens = await client.getTokens();

  const tokenIds = ['nep141:wrap.near', 'nep141:usdt.tether-token.near', 'nep141:eth.omft.near'];

  // One call, one block height, consistent numbers.
  const balances = await contract.balances(accountId, tokenIds);

  console.log(`Intents balances for ${accountId}:\n`);
  tokenIds.forEach((assetId, index) => {
    const raw = balances[index] ?? '0';
    const token = tokens.find((t) => t.assetId === assetId);
    const human = token ? formatAmount(raw, token.decimals) : raw;
    console.log(`  ${(token?.symbol ?? assetId).padEnd(8)} ${human.padStart(22)}   (${raw} raw)`);
  });

  // The pre-quote guard. BigInt, because these are smallest units.
  const wnearHeld = BigInt(balances[0] ?? '0');
  const needed = BigInt('1000000000000000000000000'); // 1 wNEAR
  console.log(`\nCan ${accountId} fund a 1 wNEAR depositType:INTENTS swap? ${wnearHeld >= needed}`);
  if (wnearHeld < needed) {
    console.log('  1Click would accept the quote anyway; the swap then sits unfunded');
    console.log('  until the deadline and is refunded. Checking here fails fast instead.');
  }

  // Nonce lookup. The definitive "did it land" answer.
  const nonce = Buffer.alloc(32).toString('base64');
  const used = await contract.isNonceUsed(accountId, nonce);
  console.log(`\nis_nonce_used(${accountId}, <all-zero nonce>) = ${used}`);
  console.log('\nAfter an ambiguous submit-intent, check the nonce you signed:');
  console.log('  true  -> it executed. Do NOT resubmit; look up the outcome.');
  console.log('  false -> it never landed. Resubmitting is safe.');
  console.log('\nCompare with submitIntentSafely(), which infers the same thing from');
  console.log('/v0/status. Status is derived and can lag; the nonce cannot.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
