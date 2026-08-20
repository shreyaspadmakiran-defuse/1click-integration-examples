/**
 * 1Click Earn: routing users into third-party yield.
 *
 * WHAT IT IS
 *   Earn is NOT a separate API. There are no new endpoints and no new request
 *   fields. It is the ordinary swap lifecycle pointed at a different kind of
 *   asset: you swap INTO a receipt token (a vault share) to deposit, and OUT
 *   of it to withdraw.
 *
 *   Everything you already know applies unchanged: GET /v0/tokens to resolve
 *   the receipt assetId, POST /v0/quote to price it, GET /v0/status to track.
 *
 * DEPOSIT (enter a yield position)
 *   originAsset       the payment asset the user holds
 *   destinationAsset  the RECEIPT token (vault share)
 *   recipient         who ends up holding the shares
 *
 * WITHDRAW (exit)
 *   originAsset       the RECEIPT token
 *   destinationAsset  the asset to be paid out in
 *   recipient         who receives the payout
 *
 *   swapType is EXACT_INPUT or EXACT_OUTPUT as usual. depositType and
 *   recipientType behave exactly as in 02-quotes/05-routing-types.ts.
 *
 * BEST PRACTICE
 *   Receipt tokens appreciate against the underlying, so the exchange rate
 *   moves over time by design. Quote the withdrawal at exit time; never cache
 *   a deposit-time rate and reuse it.
 *
 * AUTH  none required to quote.
 * RUN   npx ts-node examples/03-swaps/04-earn.ts
 */
import { OneClickClient, QuoteRequest, TokenInfo, parseAmount } from '../../src';

const ACCOUNT = 'example.near';

/** Quote one leg. Deposit and withdraw differ only in which way the assets point. */
async function quoteLeg(
  client: OneClickClient,
  label: string,
  from: TokenInfo,
  to: TokenInfo,
  humanAmount: string,
): Promise<void> {
  const request: QuoteRequest = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: from.assetId,
    depositType: 'INTENTS',
    amount: parseAmount(humanAmount, from.decimals),
    destinationAsset: to.assetId,
    recipient: ACCOUNT,
    recipientType: 'INTENTS',
    refundTo: ACCOUNT,
    refundType: 'INTENTS',
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };

  try {
    const quote = await client.getQuote(request);
    console.log(
      `  ${label}: ${quote.quote.amountInFormatted} ${from.symbol} -> ${quote.quote.amountOutFormatted} ${to.symbol}`,
    );
  } catch (error) {
    console.log(`  ${label}: unavailable (${error instanceof Error ? error.message.slice(0, 90) : error})`);
  }
}

async function main(): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });
  const tokens = await client.getTokens();

  // Receipt tokens are ordinary entries in GET /v0/tokens. There is no
  // separate "earn assets" endpoint; you identify them by symbol convention
  // or by the yield partner's published assetId.
  const receiptLike = tokens.filter((token) => /^(w?st|sf|v|y)/i.test(token.symbol) && token.symbol.length <= 8);

  console.log(`${tokens.length} tokens total. Candidates that look like yield-bearing receipts:`);
  for (const token of receiptLike.slice(0, 8)) {
    console.log(`  ${token.symbol.padEnd(10)} ${token.assetId.padEnd(58)} ${token.blockchain}`);
  }
  console.log('  Confirm the exact assetId with your yield partner rather than guessing by symbol.\n');

  const usdt = tokens.find((t) => t.assetId === 'nep141:usdt.tether-token.near');
  const receipt = receiptLike[0];
  if (!usdt || !receipt) {
    console.log('No suitable pair found on this network to demonstrate both legs.');
    return;
  }

  console.log(`Modelling a position in ${receipt.symbol}:`);
  // Deposit: pay in USDT, receive shares.
  await quoteLeg(client, 'deposit ', usdt, receipt, '100');
  // Withdraw: hand back shares, receive USDT.
  await quoteLeg(client, 'withdraw', receipt, usdt, '1');

  console.log('\nThere is no earn-specific endpoint and no earn-specific field.');
  console.log('Track both legs with GET /v0/status exactly like any other swap.');
  console.log('The only earn-specific concern is that the receipt rate drifts, so re-quote at exit.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
