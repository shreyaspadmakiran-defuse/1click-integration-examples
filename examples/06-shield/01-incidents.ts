/**
 * GET /incident  and  POST /incident   (Shield Incident API)
 *
 * Shield is the risk layer in front of NEAR Intents. An incident pauses
 * evaluation for a scope, so checking it before you quote stops you offering
 * a route that is currently paused.
 *
 * NOTE THE DIFFERENT HOST: https://shield.chaindefuser.com, and a different
 * credential (SHIELD_TOKEN, key_type SHIELD). It is not the 1Click JWT.
 *
 * SCOPING AN INCIDENT
 *   scopeType   chain | bridge | token | address   use the narrowest that fits
 *   scopeValue  "eth", "poa", "nep141:<contract>", or an address
 *   direction   deposit | withdraw. Often only one side is affected, and
 *               blocking both when only withdrawals are paused costs you
 *               volume for no safety gain.
 *
 * DEGRADE, DO NOT FAIL CLOSED
 *   Shield being UNREACHABLE is not the same as a chain being down. If you
 *   fail closed on a Shield outage, your integration goes offline for a
 *   problem that is not yours and not affecting swaps. Degrade to a warning
 *   and keep quoting. preflight() does exactly this.
 *
 * AUTH  SHIELD_TOKEN for reads. Writes also need incident permissions.
 * RUN   npx ts-node examples/06-shield/01-incidents.ts
 */
import { OneClickClient, QuoteRequest, ShieldClient, parseAmount, preflight } from '../../src';

async function main(): Promise<void> {
  const shieldToken = process.env.SHIELD_TOKEN;

  if (shieldToken) {
    const shield = new ShieldClient({ token: shieldToken });
    const status = await shield.getIncidents();

    console.log(`Shield status: ${status.status}`);
    if (status.status === 'operational') {
      console.log('  Nothing paused right now.');
    }
    for (const incident of status.incidents ?? []) {
      const direction = incident.direction ? `${incident.direction} only` : 'both directions';
      console.log(`  ${incident.scopeType} "${incident.scopeValue}" (${direction})`);
      if (incident.publicDescription) console.log(`    ${incident.publicDescription}`);
      // These fields only appear for partners with the status_read grant.
      if (incident.status) console.log(`    status ${incident.status}, opened ${incident.createdAt}`);
    }

    console.log('\nOpening one (needs incident permissions from Intents Support):');
    console.log('  await shield.submitIncident({');
    console.log('    scopeType: "chain",        // narrowest scope that fits');
    console.log('    scopeValue: "eth",');
    console.log('    direction: "withdraw",     // omit to pause both directions');
    console.log('    description: "Withdrawals delayed by RPC degradation",');
    console.log('  });');
  } else {
    console.log('SHIELD_TOKEN is not set, so the direct calls are skipped.');
    console.log('  Get one at https://partners.near-intents.org/api-keys with key_type SHIELD.');
  }

  // How Shield composes into a swap decision. preflight() only flags
  // incidents that touch THIS swap's chains or tokens, so an unrelated chain
  // being paused does not block you.
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });
  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  if (!wnear) throw new Error('wNEAR not listed');

  const request: QuoteRequest = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: wnear.assetId,
    depositType: 'ORIGIN_CHAIN',
    amount: parseAmount('1', wnear.decimals),
    destinationAsset: 'nep141:eth.omft.near',
    recipient: '0x0000000000000000000000000000000000000001',
    recipientType: 'DESTINATION_CHAIN',
    refundTo: 'example.near',
    refundType: 'ORIGIN_CHAIN',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  const check = await preflight(client, request, {
    shield: shieldToken ? new ShieldClient({ token: shieldToken }) : undefined,
  });

  console.log(`\npreflight for wNEAR -> ETH:  ok=${check.ok}`);
  console.log(`  blocking incidents: ${check.blockingIncidents.length}`);
  for (const problem of check.problems) console.log(`  problem: ${problem}`);
  for (const warning of check.warnings) console.log(`  warning: ${warning}`);
  console.log("\nOnly incidents matching this swap's chains or tokens block it.");
  console.log('And a Shield outage shows up as a problem entry, not as ok=false.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
