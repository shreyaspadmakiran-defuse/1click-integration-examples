/**
 * Troubleshooting by symptom.
 *
 * The official docs are indexed by endpoint. This file is indexed by what
 * goes wrong, so you can start from the symptom you can see.
 *
 * Run it against a real deposit address and it will diagnose that swap:
 *   npx ts-node examples/12-operations/01-troubleshooting.ts <depositAddress> [memo]
 *
 * Run it with no arguments for the symptom catalog.
 *
 * AUTH  none required.
 */
import { OneClickClient, TERMINAL_STATUSES, classifyError, ruleFor } from '../../src';

interface Symptom {
  symptom: string;
  causes: string[];
}

const CATALOG: Symptom[] = [
  {
    symptom: 'GET /v0/status returns 404 for an address I definitely created',
    causes: [
      'MISSING depositMemo. This is the most common cause by far. If the quote returned a depositMemo you must pass it to getStatus, or the lookup 404s and looks like the swap never existed.',
      'Wrong address: you saved the recipient or refundTo instead of depositAddress.',
      'The quote was dry:true, so no swap was ever created. A dry quote returns no depositAddress at all.',
    ],
  },
  {
    symptom: 'Stuck in PENDING_DEPOSIT and the user says they sent funds',
    causes: [
      'The deposit is still confirming on the origin chain. Call submitDepositTx with the tx hash to speed up detection.',
      'Sent to the right address but WITHOUT the required memo, on a memo chain.',
      'Sent the wrong token. The deposit address is bound to the originAsset in the quote.',
      'Sent after the deadline. Expect a refund rather than a swap.',
      'Sent below the funding floor: it would show INCOMPLETE_DEPOSIT once detected. For EXACT_INPUT the floor is amountIn; for EXACT_OUTPUT and FLEX_INPUT it is minAmountIn.',
    ],
  },
  {
    symptom: 'INCOMPLETE_DEPOSIT',
    causes: [
      'The deposit was below the funding floor. Compare against minAmountIn, NOT amountIn: a deposit between the two still swaps, and treating amountIn as the minimum wrongly flags valid deposits.',
      'Chain fees were deducted from the transfer, so less arrived than was sent. Use FLEX_INPUT when you cannot control the exact amount.',
      'It resolves to REFUNDED after the deadline.',
    ],
  },
  {
    symptom: 'REFUNDED instead of SUCCESS',
    causes: [
      'Underfunded (see INCOMPLETE_DEPOSIT).',
      'Deposit arrived after the deadline.',
      'Price moved beyond slippageTolerance before execution. Widen slippage, or shorten the gap between quoting and funding.',
      'Check refundedAmount in swapDetails, and confirm refundTo is an address the user actually controls on the refund chain.',
    ],
  },
  {
    symptom: 'Polling never finishes',
    causes: [
      'ANY_INPUT. It never reaches a terminal status by design: deposits pool and sweep. Use getAnyInputWithdrawals instead of polling status.',
      'No timeout on your poll loop. Always set one; 15 minutes is a reasonable cap for cross-chain.',
    ],
  },
  {
    symptom: '401 Unauthorized',
    causes: [
      "On /v0/quote for a CONFIDENTIAL swap: you need the END USER's session token, not your partner JWT. Pass it as getQuote(request, accessToken).",
      'On /v0/generate-intent or /v0/submit-intent: you need ONE_CLICK_API_KEY (X-API-Key). The user session token is NOT used here.',
      'On /v0/account/balances or /history: you need the user session token, not the partner JWT.',
      'On ANY_INPUT quotes: they are rejected for unauthorized callers. Set ONE_CLICK_JWT.',
      'An expired session token. Call refresh(refreshToken) proactively, before expiry.',
    ],
  },
  {
    symptom: 'Amounts are wildly wrong (out by many orders of magnitude)',
    causes: [
      "EXACT_OUTPUT with the origin token's decimals. `amount` is in DESTINATION units for that swap type. This is the single most expensive mistake in a 1Click integration.",
      'Float arithmetic instead of BigInt. A 24-decimal token exceeds what a double represents exactly.',
      'Hardcoded decimals. USDC alone has several different values across chains; always read decimals from /v0/tokens.',
    ],
  },
  {
    symptom: 'The same swap executed twice',
    causes: [
      'A retry on POST /v0/submit-intent. It is NOT idempotent; a timeout does not tell you whether it was applied. Use submitIntentSafely, which reads status before resubmitting.',
      'A retry on a non-dry quote, which allocates a SECOND deposit address rather than returning the first.',
      'A webhook handler acting on every delivery instead of only on transitions.',
    ],
  },
  {
    symptom: 'Quote signature verification fails',
    causes: [
      'You are verifying a mock quote. MockOneClickClient uses a placeholder signature on purpose. Do not disable verification to make the test pass.',
      'The response was modified in transit or by a proxy. Treat this as fatal and do NOT use the deposit address.',
      'You mutated the quote object before verifying. Verify the response exactly as received.',
    ],
  },
  {
    symptom: '429 Too Many Requests',
    causes: [
      'The Explorer API allows one request every 5 seconds per PARTNER id, not per client. Another process sharing your partner id counts against the same budget.',
      'Retries on idempotent calls back off automatically; unbounded manual retry loops do not.',
    ],
  },
];

async function diagnose(depositAddress: string, memo?: string): Promise<void> {
  const client = new OneClickClient({ jwt: process.env.ONE_CLICK_JWT });

  let status;
  try {
    status = await client.getStatus(depositAddress, memo);
  } catch (error) {
    const advice = classifyError(error);
    console.log(`Lookup failed: ${advice.kind}\n`);
    if (advice.kind === 'NOT_FOUND') {
      console.log('Most likely, in order:');
      console.log('  1. A missing depositMemo. Retry with the memo from the quote.');
      console.log('  2. The wrong address (recipient or refundTo instead of depositAddress).');
      console.log('  3. The quote was dry:true, so no swap exists.');
    }
    return;
  }

  const request = status.quoteResponse?.quoteRequest;
  const quote = status.quoteResponse?.quote;
  console.log(`status:   ${status.status}`);
  console.log(`swapType: ${request?.swapType}`);
  console.log(`routing:  ${request?.depositType} -> ${request?.recipientType}`);
  console.log(`updated:  ${status.updatedAt}\n`);

  if (TERMINAL_STATUSES.includes(status.status)) {
    if (status.status === 'SUCCESS') {
      console.log(`Delivered ${status.swapDetails?.amountOutFormatted ?? '?'} to ${request?.recipient}.`);
      return;
    }
    if (status.status === 'REFUNDED') {
      console.log(`Refunded ${status.swapDetails?.refundedAmountFormatted ?? '?'} to ${request?.refundTo}.`);
      console.log('\nWhy this usually happens:');
      console.log('  - the deposit was below the funding floor');
      console.log('  - the deposit arrived after the deadline');
      console.log('  - price moved beyond slippageTolerance');
      if (quote && request) {
        const floor = request.swapType === 'EXACT_INPUT' ? quote.amountIn : quote.minAmountIn;
        console.log(`\nThe floor for this ${request.swapType} swap was ${floor}.`);
      }
      return;
    }
    console.log('FAILED is terminal. Gather the correlationId and contact support:');
    console.log(`  correlationId: ${status.correlationId}`);
    return;
  }

  // Not terminal: say what it is waiting for.
  if (request && !ruleFor(request.swapType).settlesToTerminalStatus) {
    console.log('This is an ANY_INPUT swap. It NEVER reaches a terminal status.');
    console.log('Stop polling and reconcile sweeps instead:');
    console.log(`  client.getAnyInputWithdrawals({ depositAddress: "${depositAddress}" })`);
    return;
  }

  if (status.status === 'PENDING_DEPOSIT') {
    console.log('No deposit detected yet. Check, in order:');
    console.log(`  1. Were funds sent to exactly ${depositAddress}?`);
    if (quote?.depositMemo) console.log(`  2. WITH memo ${quote.depositMemo}? This chain requires it.`);
    console.log(`  3. In ${request?.originAsset}? The address is bound to that asset.`);
    console.log(`  4. Before ${quote?.deadline}? Later deposits are refunded.`);
    console.log('  5. Speed up detection: client.submitDepositTx({ depositAddress, txHash })');
  } else if (status.status === 'INCOMPLETE_DEPOSIT') {
    const floor = request?.swapType === 'EXACT_INPUT' ? quote?.amountIn : quote?.minAmountIn;
    console.log(`Underfunded. The floor for ${request?.swapType} is ${floor}.`);
    console.log(`Received so far: ${status.swapDetails?.amountIn ?? 'unknown'}.`);
    console.log('Top it up before the deadline, or it will be refunded.');
  } else {
    console.log('In flight. Allow up to 15 minutes for cross-chain processing.');
  }
}

async function main(): Promise<void> {
  const [depositAddress, memo] = process.argv.slice(2);

  if (depositAddress) {
    await diagnose(depositAddress, memo);
    return;
  }

  console.log('SYMPTOM CATALOG');
  console.log(
    'Diagnose a specific swap: npx ts-node examples/12-operations/01-troubleshooting.ts <depositAddress> [memo]\n',
  );
  for (const entry of CATALOG) {
    console.log(`\n${'='.repeat(76)}`);
    console.log(entry.symptom);
    console.log('='.repeat(76));
    entry.causes.forEach((cause, index) => console.log(`  ${index + 1}. ${cause}`));
  }

  console.log('\n\nWhen escalating to support, always include:');
  console.log('  - the depositAddress (and depositMemo if any)');
  console.log('  - the correlationId from the quote or status response');
  console.log('  - your deposit tx hash');
  console.log('  - the exact quote request you sent');
  console.log('  Support: https://t.me/near_intents');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
