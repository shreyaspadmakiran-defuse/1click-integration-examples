import { ApiError } from '../client/http';
import { OneClickClient } from '../client/one-click-client';
import { SubmitIntentRequest, SubmitIntentResponse } from '../types/one-click';
import { logger } from '../utils/logger';
import { sleep } from '../utils/retry';

export interface SafeSubmitResult extends SubmitIntentResponse {
  /** true when the intent turned out to be already accepted and no resubmission happened */
  recovered: boolean;
}

/**
 * Submits a signed intent with ambiguous-failure recovery.
 *
 * POST /v0/submit-intent is not idempotent, so it must never be blindly
 * retried: a timeout does not tell you whether the server processed the
 * intent. The correct recovery is to consult GET /v0/status for the
 * quote's depositAddress:
 *
 * - a 4xx from submit-intent is a definitive rejection: rethrown as is
 * - on an ambiguous failure (network error, timeout, 5xx), check status:
 *   if the swap already moved past PENDING_DEPOSIT or an intent hash is
 *   recorded, the first submission landed, so return it instead of
 *   resubmitting; if the swap is still PENDING_DEPOSIT, the submission
 *   never arrived and retrying is safe
 */
export async function submitIntentSafely(
  client: OneClickClient,
  request: SubmitIntentRequest,
  depositAddress: string,
  options: { depositMemo?: string; maxAttempts?: number; retryDelayMs?: number } = {},
): Promise<SafeSubmitResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await client.submitIntent(request);
      return { ...result, recovered: false };
    } catch (error) {
      // Definitive rejection: bad signature, bad quote state, expired, etc.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;

      lastError = error;
      logger.warn(`submit-intent attempt ${attempt} failed ambiguously, checking status`, String(error));

      const status = await client.getStatus(depositAddress, options.depositMemo);
      const recordedHash = status.swapDetails?.intentHashes?.[0];
      if (recordedHash || status.status !== 'PENDING_DEPOSIT') {
        logger.info(`Intent already accepted (status ${status.status}), not resubmitting`);
        return { intentHash: recordedHash ?? '', correlationId: status.correlationId, recovered: true };
      }

      if (attempt < maxAttempts) await sleep(options.retryDelayMs ?? 1_000);
    }
  }
  throw lastError;
}
