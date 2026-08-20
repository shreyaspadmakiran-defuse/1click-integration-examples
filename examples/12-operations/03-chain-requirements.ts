/**
 * Chain-specific requirements: the things that are not in any table.
 *
 * The API surface is uniform across chains. Reality is not. Three differences
 * cause most cross-chain integration bugs, and none of them are visible from
 * the request schema.
 *
 *   1. ADDRESS FORMAT
 *      `recipient` must be valid for the DESTINATION chain, and `refundTo`
 *      for the REFUND chain. Sending an 0x address to a NEAR recipient, or a
 *      NEAR account to an Ethereum recipient, produces a well-formed request
 *      that delivers nowhere recoverable. The API cannot validate this for
 *      you, so validate it yourself before quoting.
 *
 *   2. MEMO CHAINS
 *      Some chains identify deposits by memo rather than by unique address.
 *      When a quote returns depositMemo you MUST send it with the deposit and
 *      pass it to every status lookup. Omitting it on the deposit means the
 *      funds are unattributed; omitting it on the lookup means a 404 that
 *      looks like the swap vanished.
 *
 *   3. DECIMALS
 *      The same nominal token has different decimals on different chains.
 *      Always read decimals from /v0/tokens, per assetId, never per symbol.
 *
 * This file derives what it can from live data rather than hardcoding a list
 * that will drift.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/12-operations/03-chain-requirements.ts
 */
import { OneClickClient, TokenInfo } from '../../src';

/**
 * Address shape validators, keyed by chain family. Deliberately conservative:
 * these catch the common class of error (wrong chain family entirely) without
 * pretending to fully validate every format.
 */
const ADDRESS_RULES: Record<string, { test: (address: string) => boolean; describe: string }> = {
  near: {
    test: (address) => /^[a-z0-9._-]+$/.test(address) && !address.startsWith('0x'),
    describe: 'lowercase account id, e.g. alice.near or a 64-char implicit account',
  },
  eth: { test: (address) => /^0x[a-fA-F0-9]{40}$/.test(address), describe: '0x + 40 hex chars' },
  arb: { test: (address) => /^0x[a-fA-F0-9]{40}$/.test(address), describe: '0x + 40 hex chars' },
  base: { test: (address) => /^0x[a-fA-F0-9]{40}$/.test(address), describe: '0x + 40 hex chars' },
  bsc: { test: (address) => /^0x[a-fA-F0-9]{40}$/.test(address), describe: '0x + 40 hex chars' },
  pol: { test: (address) => /^0x[a-fA-F0-9]{40}$/.test(address), describe: '0x + 40 hex chars' },
  sol: { test: (address) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address), describe: 'base58, 32-44 chars' },
  btc: {
    test: (address) => /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(address),
    describe: 'bc1... (bech32) or 1.../3... (legacy)',
  },
  doge: { test: (address) => /^D[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address), describe: 'D + base58' },
  xrp: { test: (address) => /^r[a-km-zA-HJ-NP-Z1-9]{24,34}$/.test(address), describe: 'r + base58, memo required' },
  ton: { test: (address) => /^[EU]Q[A-Za-z0-9_-]{46}$/.test(address), describe: 'EQ/UQ + base64url, memo required' },
  tron: { test: (address) => /^T[a-km-zA-HJ-NP-Z1-9]{33}$/.test(address), describe: 'T + base58' },
  stellar: { test: (address) => /^G[A-Z2-7]{55}$/.test(address), describe: 'G + base32, memo required' },
};

/** Chains that identify deposits by memo. Confirm per-quote via depositMemo. */
const MEMO_CHAINS = new Set(['xrp', 'ton', 'stellar', 'cosmos', 'eos', 'hbar']);

function validateRecipient(address: string, blockchain: string): { ok: boolean; note: string } {
  const rule = ADDRESS_RULES[blockchain];
  if (!rule) return { ok: true, note: `no local rule for "${blockchain}"; verify format yourself` };
  return rule.test(address)
    ? { ok: true, note: `looks like a valid ${blockchain} address` }
    : { ok: false, note: `NOT a valid ${blockchain} address (expected ${rule.describe})` };
}

async function main(): Promise<void> {
  const client = new OneClickClient();
  const tokens = await client.getTokens();

  const chains = [...new Set(tokens.map((token) => token.blockchain))].sort();
  console.log(`${chains.length} chains supported, ${tokens.length} assets total\n`);

  console.log('MEMO REQUIREMENT BY CHAIN');
  console.log('='.repeat(76));
  const memoChains = chains.filter((chain) => MEMO_CHAINS.has(chain));
  const plainChains = chains.filter((chain) => !MEMO_CHAINS.has(chain));
  console.log(`  memo required:  ${memoChains.join(', ') || 'none of the listed chains'}`);
  console.log(`  address only:   ${plainChains.slice(0, 12).join(', ')}${plainChains.length > 12 ? ', ...' : ''}`);
  console.log('\n  Do not rely on this list. The authoritative signal is per-quote:');
  console.log('    if (quote.quote.depositMemo) { /* send it, store it, pass it to getStatus */ }');

  console.log('\n\nADDRESS FORMAT VALIDATION');
  console.log('='.repeat(76));
  const cases = [
    { address: '0x0000000000000000000000000000000000000001', chain: 'eth' },
    { address: 'alice.near', chain: 'near' },
    { address: '0x0000000000000000000000000000000000000001', chain: 'near' },
    { address: 'alice.near', chain: 'eth' },
    { address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', chain: 'btc' },
  ];
  for (const testCase of cases) {
    const result = validateRecipient(testCase.address, testCase.chain);
    const flag = result.ok ? 'ok  ' : 'FAIL';
    console.log(`  ${flag}  ${testCase.address.slice(0, 44).padEnd(46)} as ${testCase.chain.padEnd(8)} ${result.note}`);
  }
  console.log('\n  The two failures above are exactly the requests the API accepts and');
  console.log('  cannot deliver. Validate recipient against the DESTINATION chain, and');
  console.log('  refundTo against the REFUND chain, before you quote.');

  console.log('\n\nDECIMALS VARY FOR THE SAME SYMBOL');
  console.log('='.repeat(76));
  const bySymbol = new Map<string, TokenInfo[]>();
  for (const token of tokens) {
    bySymbol.set(token.symbol, [...(bySymbol.get(token.symbol) ?? []), token]);
  }
  const inconsistent = [...bySymbol.entries()]
    .filter(([, entries]) => new Set(entries.map((entry) => entry.decimals)).size > 1)
    .slice(0, 5);

  for (const [symbol, entries] of inconsistent) {
    const variants = [...new Set(entries.map((entry) => `${entry.decimals}dp on ${entry.blockchain}`))];
    console.log(`  ${symbol.padEnd(8)} ${variants.slice(0, 4).join(', ')}`);
  }
  console.log(`\n  ${inconsistent.length} symbol(s) shown with inconsistent decimals across chains.`);
  console.log('  Resolve decimals by assetId, never by symbol.');

  console.log('\n\nPRE-QUOTE CHECKLIST');
  console.log('='.repeat(76));
  console.log('  1. recipient is valid for the destination chain');
  console.log('  2. refundTo is valid for the refund chain AND you/the user control it');
  console.log('  3. decimals came from /v0/tokens, by assetId');
  console.log('  4. if the quote returns depositMemo, it is persisted with the deposit address');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
