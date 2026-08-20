/**
 * Error classification.
 *
 * After a failed 1Click call you need to know what you are allowed to do
 * next. There are three answers:
 *
 *   retryable  - the identical request can be sent again safely
 *   ambiguous  - the request may or may not have been applied, so retrying
 *                risks doing it twice; reconcile against server state instead
 *   terminal   - the server made a decision; retrying changes nothing
 *
 * Which one applies depends on the call, not the error. A timeout on
 * GET /v0/tokens is retryable. The same timeout on POST /v0/submit-intent is
 * ambiguous, and retrying it can submit the same intent twice.
 */
import { ApiError } from '../client/http';

export type ErrorKind =
  | 'AUTH'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'RATE_LIMIT'
  | 'SERVER'
  | 'NETWORK'
  | 'UNKNOWN';

export interface ErrorAdvice {
  kind: ErrorKind;
  /** HTTP status when the failure came from the API */
  status?: number;
  /**
   * Safe to send the identical request again. Only ever true for calls that
   * are idempotent to begin with; see `ambiguous` for the rest.
   */
  retryable: boolean;
  /**
   * The request may have been applied even though it failed. Never retry a
   * non-idempotent call in this state: read back the server's state instead.
   */
  ambiguous: boolean;
  message: string;
  /** What a caller should actually do about it */
  hint: string;
}

function adviceForStatus(status: number, message: string): ErrorAdvice {
  if (status === 401) {
    return {
      kind: 'AUTH',
      status,
      retryable: false,
      ambiguous: false,
      message,
      hint: 'Credentials missing or invalid. ONE_CLICK_JWT for quotes, ONE_CLICK_API_KEY for intent routes, SHIELD_TOKEN for Shield.',
    };
  }
  if (status === 403) {
    return {
      kind: 'FORBIDDEN',
      status,
      retryable: false,
      ambiguous: false,
      message,
      hint: 'Authenticated but not permitted. The key is likely missing a grant for this route.',
    };
  }
  if (status === 404) {
    return {
      kind: 'NOT_FOUND',
      status,
      retryable: false,
      ambiguous: false,
      message,
      hint: 'For GET /v0/status this usually means a wrong depositAddress, or a missing depositMemo on a memo chain.',
    };
  }
  if (status === 429) {
    return {
      kind: 'RATE_LIMIT',
      status,
      retryable: true,
      ambiguous: false,
      message,
      hint: 'Back off and retry with exponential delay. withRetry() already does this for idempotent calls.',
    };
  }
  if (status >= 400 && status < 500) {
    return {
      kind: 'INVALID_REQUEST',
      status,
      retryable: false,
      ambiguous: false,
      message,
      hint: 'The server rejected the request definitively. Fix the request; retrying it unchanged will fail again.',
    };
  }
  return {
    kind: 'SERVER',
    status,
    retryable: true,
    // A 5xx can still mean the write landed before the response was lost.
    ambiguous: true,
    message,
    hint: 'Transient server error. Safe to retry idempotent calls; for writes, reconcile with GET /v0/status first.',
  };
}

export function classifyError(error: unknown): ErrorAdvice {
  if (error instanceof ApiError) {
    return adviceForStatus(error.status, error.message);
  }
  if (error instanceof Error) {
    // AbortSignal.timeout() rejects with TimeoutError; fetch failures vary by runtime.
    const isTimeout = error.name === 'TimeoutError' || /timeout|aborted/i.test(error.message);
    return {
      kind: 'NETWORK',
      retryable: true,
      ambiguous: true,
      message: error.message,
      hint: isTimeout
        ? 'The request timed out with no response, so you cannot tell whether it was applied. Read server state before retrying a write.'
        : 'Network failure before a response arrived. Same rule: reconcile before retrying a write.',
    };
  }
  return {
    kind: 'UNKNOWN',
    retryable: false,
    ambiguous: true,
    message: String(error),
    hint: 'Unrecognized failure. Treat it as ambiguous and reconcile against server state.',
  };
}

/** One-line explanation suitable for logs or a CLI. */
export function explainError(error: unknown): string {
  const advice = classifyError(error);
  const status = advice.status ? ` ${advice.status}` : '';
  return `[${advice.kind}${status}] ${advice.message}\n  ${advice.hint}`;
}

/** True when the identical request can safely be sent again. */
export function isRetryable(error: unknown): boolean {
  return classifyError(error).retryable;
}

/**
 * True when the request might already have been applied. Non-idempotent
 * writes must reconcile rather than retry when this is true.
 */
export function isAmbiguous(error: unknown): boolean {
  return classifyError(error).ambiguous;
}
