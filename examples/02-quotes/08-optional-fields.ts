/**
 * The remaining QuoteRequest fields, and when each one matters.
 *
 *   deadline            REQUIRED. ISO timestamp. The quote and its deposit
 *                       address expire at this time. Too short and users miss
 *                       it; too long and you hold a stale price. 10 minutes is
 *                       a reasonable default for interactive flows.
 *
 *   depositMode         SIMPLE | MEMO. Some chains identify deposits by memo
 *                       rather than by unique address. When the quote returns
 *                       a depositMemo you MUST send it with the deposit and
 *                       pass it to /v0/status, or the lookup 404s.
 *
 *   quoteWaitingTimeMs  how long 1Click waits for solver responses. Longer
 *                       can mean better pricing; shorter is more responsive.
 *
 *   referral            analytics tag. Free, attributes volume to you.
 *
 *   confidentiality     public | basic | advanced. See 03-swaps/03.
 *
 *   virtualChainRecipient / virtualChainRefundRecipient
 *                       for virtual chains (e.g. Aurora-style), where the
 *                       real recipient sits behind the settlement address.
 *
 *   customRecipientMsg  message passed along with the delivery, for
 *                       contract recipients that expect one.
 *
 *   connectedWallets / sessionId
 *                       attribution and session correlation.
 *
 * BEST PRACTICE
 *   Set deadline deliberately per flow, and always thread depositMemo through
 *   deposit, /v0/deposit/submit, and /v0/status. Memo loss is the single most
 *   common cause of "my swap disappeared".
 *
 * AUTH  none required.
 * RUN   npx ts-node examples/02-quotes/08-optional-fields.ts
 */
import { OneClickClient, QuoteRequest, parseAmount } from '../../src';

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  const tokens = await client.getTokens();
  const wnear = tokens.find((t) => t.assetId === 'nep141:wrap.near');
  if (!wnear) throw new Error('wNEAR not listed');

  const base: QuoteRequest = {
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

  // deadline: what you are choosing between.
  for (const minutes of [2, 10, 60]) {
    const request = { ...base, deadline: new Date(Date.now() + minutes * 60_000).toISOString() };
    const quote = await client.getQuote(request);
    console.log(`deadline ${String(minutes).padStart(2)}min -> quote deadline ${quote.quote.deadline ?? 'n/a'}`);
  }
  console.log('  Short: fresher price, more expiries. Long: fewer expiries, staler price.');

  // quoteWaitingTimeMs: how long to shop around.
  console.log('\nquoteWaitingTimeMs:');
  for (const waitMs of [1_000, 3_000]) {
    const started = Date.now();
    const quote = await client.getQuote({ ...base, quoteWaitingTimeMs: waitMs });
    console.log(`  ${waitMs}ms -> ${quote.quote.amountOutFormatted} USDT (round trip ${Date.now() - started}ms)`);
  }

  // referral: free attribution.
  const referred = await client.getQuote({ ...base, referral: 'my-app-v2' });
  console.log(`\nreferral tag attached, output unchanged: ${referred.quote.amountOutFormatted} USDT`);

  // depositMemo: only appears for chains that need it, and only on a real
  // (dry:false) quote. Handle it whenever it is present.
  console.log('\ndepositMemo handling, the pattern to copy everywhere:');
  console.log('  const { depositAddress, depositMemo } = quote.quote;');
  console.log('  // 1. send the deposit WITH the memo');
  console.log('  // 2. client.submitDepositTx({ depositAddress, txHash, memo: depositMemo })');
  console.log('  // 3. client.getStatus(depositAddress, depositMemo)');
  console.log('  Persist depositMemo alongside depositAddress. Without it, step 3 returns 404.');

  console.log('\nVirtual chains and contract recipients:');
  console.log('  virtualChainRecipient       real recipient behind a settlement address');
  console.log('  virtualChainRefundRecipient the refund equivalent');
  console.log('  customRecipientMsg          message forwarded to a contract recipient');
  console.log('  All three echo back on the quote so you can confirm they were applied.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
