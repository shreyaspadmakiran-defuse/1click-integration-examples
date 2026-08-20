/**
 * depositType, recipientType, refundType: where funds come from and go to.
 *
 * These three are independent of swapType and of each other. They decide
 * whether a swap touches a chain at all.
 *
 *   depositType    where funds come FROM
 *     ORIGIN_CHAIN          an on-chain deposit you broadcast to an address
 *     INTENTS               a public balance already inside Intents
 *     CONFIDENTIAL_INTENTS  a confidential balance inside Intents
 *
 *   recipientType  where the output GOES
 *     DESTINATION_CHAIN     a normal address on the target chain
 *     INTENTS               stays inside Intents as a balance
 *     CONFIDENTIAL_INTENTS  stays inside, confidentially
 *
 *   refundType     where a failed or underfunded swap returns to
 *   refundTo       the address for that
 *
 * ADDRESS FORMAT MUST MATCH THE TYPE
 *   `recipient` must be an address valid for `recipientType`, and `refundTo`
 *   valid for `refundType`. An EVM 0x address with recipientType INTENTS, or
 *   a NEAR account with DESTINATION_CHAIN on Ethereum, is a well-formed
 *   request that delivers nowhere useful. The API cannot catch this for you.
 *
 * BEST PRACTICE
 *   Refunds should follow the deposit back to where it came from. An
 *   ORIGIN_CHAIN deposit refunds to ORIGIN_CHAIN; an INTENTS deposit refunds
 *   to INTENTS. Refunding to a chain the user cannot access is unrecoverable.
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/02-quotes/05-routing-types.ts
 */
import { OneClickClient, QuoteRequest, parseAmount } from '../../src';

const NEAR_ACCOUNT = 'example.near';
const EVM_ADDRESS = '0x0000000000000000000000000000000000000001';

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  const usdt = tokens.find((t) => t.assetId === 'nep141:usdt.tether-token.near');
  const ethOnNear = tokens.find((t) => t.assetId === 'nep141:eth.omft.near');
  if (!wnear || !usdt || !ethOnNear) throw new Error('Expected assets not listed');

  const routings = [
    {
      title: 'ORIGIN_CHAIN -> DESTINATION_CHAIN   (the classic bridge swap)',
      depositType: 'ORIGIN_CHAIN' as const,
      recipientType: 'DESTINATION_CHAIN' as const,
      recipient: EVM_ADDRESS,
      destinationAsset: ethOnNear.assetId,
      note: 'recipient is an EVM address, because the output lands on Ethereum',
    },
    {
      title: 'ORIGIN_CHAIN -> INTENTS             (deposit and hold)',
      depositType: 'ORIGIN_CHAIN' as const,
      recipientType: 'INTENTS' as const,
      recipient: NEAR_ACCOUNT,
      destinationAsset: usdt.assetId,
      note: 'recipient is a NEAR account, because Intents balances are keyed by account',
    },
    {
      title: 'INTENTS -> DESTINATION_CHAIN        (swap and withdraw)',
      depositType: 'INTENTS' as const,
      recipientType: 'DESTINATION_CHAIN' as const,
      recipient: EVM_ADDRESS,
      destinationAsset: ethOnNear.assetId,
      note: 'no on-chain deposit to wait for, so this is the fastest path',
    },
    {
      title: 'INTENTS -> INTENTS                  (internal rebalance)',
      depositType: 'INTENTS' as const,
      recipientType: 'INTENTS' as const,
      recipient: NEAR_ACCOUNT,
      destinationAsset: usdt.assetId,
      note: 'never touches a chain: no deposit, no withdrawal, no gas',
    },
  ];

  for (const routing of routings) {
    console.log(`\n${routing.title}`);
    console.log(`  ${routing.note}`);

    const request: QuoteRequest = {
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: wnear.assetId,
      depositType: routing.depositType,
      amount: parseAmount('1', wnear.decimals),
      destinationAsset: routing.destinationAsset,
      recipient: routing.recipient,
      recipientType: routing.recipientType,
      // Refunds follow the deposit home.
      refundTo: NEAR_ACCOUNT,
      refundType: routing.depositType === 'ORIGIN_CHAIN' ? 'ORIGIN_CHAIN' : 'INTENTS',
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    };

    try {
      const quote = await client.getQuote(request);
      console.log(`  quoted:  ${quote.quote.amountInFormatted} -> ${quote.quote.amountOutFormatted}`);
      console.log(`  refunds: ${request.refundTo} as ${request.refundType}`);
      // Only ORIGIN_CHAIN produces something to send funds to.
      console.log(`  needs an on-chain deposit: ${request.depositType === 'ORIGIN_CHAIN'}`);
    } catch (error) {
      // Not every routing is available for every pair. Report and continue.
      console.log(`  unavailable: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
    }
  }

  console.log('\nPicking depositType decides the whole execution flow:');
  console.log('  ORIGIN_CHAIN  -> 03-swaps/01-origin-chain.ts   (fund an address)');
  console.log('  INTENTS       -> 03-swaps/02-signed-intent.ts  (sign a message)');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
