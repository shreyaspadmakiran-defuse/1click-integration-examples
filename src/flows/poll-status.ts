import { OneClickClient } from '../client/one-click-client';
import { DEFAULT_POLL_INTERVAL_MS, DEFAULT_POLL_TIMEOUT_MS } from '../config/constants';
import { SWAP_TYPE_RULES } from '../config/swap-rules';
import { ExecutionStatus, SwapStatus, TERMINAL_STATUSES } from '../types/one-click';
import { logger } from '../utils/logger';
import { sleep } from '../utils/retry';

export interface PollOptions {
  depositMemo?: string;
  intervalMs?: number;
  timeoutMs?: number;
  /** Called on every status change, useful for UI updates */
  onUpdate?: (status: ExecutionStatus) => void;
}

/**
 * Polls GET /v0/status until the swap reaches a terminal state
 * (SUCCESS, REFUNDED, or FAILED) or the timeout elapses.
 */
export async function pollUntilSettled(
  client: OneClickClient,
  depositAddress: string,
  options: PollOptions = {},
): Promise<ExecutionStatus> {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const startedAt = Date.now();

  let lastStatus: SwapStatus | undefined;
  let checkedSwapType = false;
  for (;;) {
    const status = await client.getStatus(depositAddress, options.depositMemo);

    // The status response carries the original request, so we can tell the
    // caller they are waiting for something that will never arrive.
    if (!checkedSwapType) {
      checkedSwapType = true;
      const swapType = status.quoteResponse?.quoteRequest?.swapType;
      if (swapType && !SWAP_TYPE_RULES[swapType]?.settlesToTerminalStatus) {
        logger.warn(
          `${depositAddress} is a ${swapType} swap, which never reaches a terminal status. ` +
            'This poll will time out. Use getAnyInputWithdrawals() to reconcile sweeps instead.',
        );
      }
    }

    if (status.status !== lastStatus) {
      lastStatus = status.status;
      logger.info(`Swap ${depositAddress}: ${status.status}`);
      options.onUpdate?.(status);
    }
    if (TERMINAL_STATUSES.includes(status.status)) return status;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${depositAddress}, last status: ${status.status}`);
    }
    await sleep(intervalMs);
  }
}
