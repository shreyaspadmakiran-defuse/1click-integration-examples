/**
 * Which options fit YOUR use case.
 *
 * The docs explain what each option does. They do not tell you which to pick.
 * This file is that decision, made explicit, so you do not have to reverse it
 * out of four reference pages.
 *
 * THREE INDEPENDENT DECISIONS
 *   1. swapType      what is fixed: the input, the output, neither, or n/a
 *   2. depositType   where funds come from
 *   3. recipientType where output goes
 *
 * They compose. Pick each on its own merits, then check the combination is
 * legal (some are not; the validator catches those).
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/00-start-here/02-which-integration.ts
 */
import { SWAP_TYPE_RULES, SwapType, ruleFor } from '../../src';

interface UseCase {
  scenario: string;
  swapType: SwapType;
  depositType: string;
  recipientType: string;
  why: string;
  example: string;
}

const USE_CASES: UseCase[] = [
  {
    scenario: 'Wallet swap: user picks an amount to send',
    swapType: 'EXACT_INPUT',
    depositType: 'ORIGIN_CHAIN',
    recipientType: 'DESTINATION_CHAIN',
    why: 'The user chose the input, so fix the input. Funds move chain to chain.',
    example: '03-swaps/01-origin-chain.ts',
  },
  {
    scenario: 'Checkout / invoice: you need an exact amount paid',
    swapType: 'EXACT_OUTPUT',
    depositType: 'ORIGIN_CHAIN',
    recipientType: 'DESTINATION_CHAIN',
    why: 'The invoice fixes the OUTPUT. Watch out: `amount` is in destination units.',
    example: '02-quotes/02-exact-output.ts',
  },
  {
    scenario: 'You cannot control the deposit to the wei (user-typed, exchange sweep)',
    swapType: 'FLEX_INPUT',
    depositType: 'ORIGIN_CHAIN',
    recipientType: 'DESTINATION_CHAIN',
    why: 'EXACT_INPUT would refund a deposit that is slightly off. FLEX accepts a band.',
    example: '02-quotes/03-flex-input.ts',
  },
  {
    scenario: 'Donations or fee collection in many tokens',
    swapType: 'ANY_INPUT',
    depositType: 'INTENTS',
    recipientType: 'INTENTS',
    why: 'One standing address accepts anything and sweeps into one asset. Never terminal.',
    example: '02-quotes/04-any-input.ts',
  },
  {
    scenario: 'Your users already hold balances inside NEAR Intents',
    swapType: 'EXACT_INPUT',
    depositType: 'INTENTS',
    recipientType: 'INTENTS',
    why: 'No on-chain deposit to wait for, so this is the fastest path. Sign instead of send.',
    example: '03-swaps/02-signed-intent.ts',
  },
  {
    scenario: 'Privacy-sensitive balances',
    swapType: 'EXACT_INPUT',
    depositType: 'CONFIDENTIAL_INTENTS',
    recipientType: 'CONFIDENTIAL_INTENTS',
    why: 'Required for confidential balances: no RPC path reaches them. Needs BOTH credentials.',
    example: '03-swaps/03-confidential.ts',
  },
  {
    scenario: 'Routing users into yield',
    swapType: 'EXACT_INPUT',
    depositType: 'ORIGIN_CHAIN',
    recipientType: 'INTENTS',
    why: 'Earn is a normal swap into a receipt token. No new endpoints.',
    example: '03-swaps/04-earn.ts',
  },
];

async function main(): Promise<void> {
  console.log('DECISION 1: swapType\n');
  console.log('  What is fixed?');
  console.log('    the input                  -> EXACT_INPUT');
  console.log('    the output                 -> EXACT_OUTPUT   (amount is in DESTINATION units)');
  console.log('    roughly the input          -> FLEX_INPUT     (a band, not a number)');
  console.log('    nothing, accept everything -> ANY_INPUT      (a collection address)\n');

  console.log('DECISION 2: depositType, where funds come FROM\n');
  console.log('    a chain                        -> ORIGIN_CHAIN          (user sends to an address)');
  console.log('    a public Intents balance       -> INTENTS               (user signs a message)');
  console.log('    a confidential Intents balance -> CONFIDENTIAL_INTENTS  (must sign; no RPC path)\n');

  console.log('DECISION 3: recipientType, where output GOES\n');
  console.log('    a chain address           -> DESTINATION_CHAIN');
  console.log('    stays inside Intents      -> INTENTS');
  console.log('    stays inside, private     -> CONFIDENTIAL_INTENTS');
  console.log('  `recipient` MUST be a valid address for whichever you choose.\n');

  console.log('='.repeat(78));
  console.log('COMMON USE CASES');
  console.log('='.repeat(78));
  for (const useCase of USE_CASES) {
    console.log(`\n${useCase.scenario}`);
    console.log(`  ${useCase.swapType} / ${useCase.depositType} -> ${useCase.recipientType}`);
    console.log(`  ${useCase.why}`);
    console.log(`  see: examples/${useCase.example}`);
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('LEGAL COMBINATIONS (the ones that will be rejected)');
  console.log('='.repeat(78));
  for (const swapType of Object.keys(SWAP_TYPE_RULES) as SwapType[]) {
    const rule = ruleFor(swapType);
    console.log(`\n${swapType}`);
    console.log(`  depositTypes:   ${rule.depositTypes.join(', ')}`);
    console.log(`  amount is in:   ${rule.amountUnit.toLowerCase()} units`);
    console.log(`  refundable:     ${rule.refundable}`);
    console.log(`  reaches SUCCESS: ${rule.settlesToTerminalStatus}`);
  }
  console.log('\nANY_INPUT cannot use ORIGIN_CHAIN, and never reaches a terminal status.');
  console.log('\nvalidateQuoteRequest() checks all of this locally, before any network call.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
