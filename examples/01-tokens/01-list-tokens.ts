/**
 * GET /v0/tokens
 *
 * The call every integration starts with. It is the only source of two things
 * you cannot guess: the canonical `assetId` for a token, and its `decimals`.
 *
 * FIELDS
 *   assetId     the ONLY identifier the API accepts. Not a symbol, not a
 *               contract address. "nep141:wrap.near", "nep141:eth-0x...omft.near"
 *   decimals    how to interpret every amount for this token
 *   blockchain  which chain it lives on
 *   symbol      display only. NOT unique: "USDC" exists on many chains with
 *               different assetIds and sometimes different decimals
 *   price       indicative USD price, with priceUpdatedAt
 *
 * BEST PRACTICE
 *   Fetch once at startup and cache it, then resolve assetIds and decimals
 *   from the cache. Fetching per swap is slow and invites the mistake of
 *   hardcoding decimals when the call fails.
 *
 * AUTH  none. Public endpoint.
 * RUN   npx ts-node examples/01-tokens/01-list-tokens.ts
 */
import { OneClickClient } from '../../src';

async function main(): Promise<void> {
  const client = new OneClickClient();

  const tokens = await client.getTokens();
  console.log(`${tokens.length} tokens supported\n`);

  // Every token carries the four fields you actually need.
  const wnear = tokens.find((token) => token.assetId === 'nep141:wrap.near');
  console.log('A single token record:');
  console.log(JSON.stringify(wnear, null, 2));

  // Filtering by chain: how you build a "what can I send from here" list.
  const onNear = tokens.filter((token) => token.blockchain === 'near');
  console.log(`\n${onNear.length} tokens on NEAR. First five:`);
  for (const token of onNear.slice(0, 5)) {
    console.log(`  ${token.symbol.padEnd(8)} ${token.assetId.padEnd(60)} ${token.decimals} decimals`);
  }

  // Why symbols are not identifiers. Resolving a user's "USDC" to an assetId
  // requires knowing the chain too, otherwise you may pick the wrong one.
  const usdc = tokens.filter((token) => token.symbol.toUpperCase() === 'USDC');
  console.log(`\n"USDC" matches ${usdc.length} different assets:`);
  for (const token of usdc.slice(0, 6)) {
    console.log(`  ${token.blockchain.padEnd(10)} ${token.assetId.padEnd(60)} ${token.decimals} decimals`);
  }
  console.log(`  decimals seen across them: ${[...new Set(usdc.map((t) => t.decimals))].join(', ')}`);
  console.log('  Hardcoding 6 decimals for "USDC" is wrong for at least one of these.');

  // Build the lookup you will actually use everywhere else.
  const decimalsByAssetId = new Map(tokens.map((token) => [token.assetId, token.decimals]));
  console.log(`\nCached ${decimalsByAssetId.size} assetId -> decimals entries for the rest of your app.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
