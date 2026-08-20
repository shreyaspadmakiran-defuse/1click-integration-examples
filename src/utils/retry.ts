export interface RetryOptions {
  retries?: number;
  /** Initial backoff, doubled each attempt */
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Decide whether a thrown error should be retried */
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries fn with exponential backoff. Only used for idempotent calls
 * (GET requests and dry quotes). Non-idempotent POSTs are never retried
 * automatically, so a flaky network cannot double-submit an intent.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, minDelayMs = 500, maxDelayMs = 8_000, shouldRetry = () => true, onRetry } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error)) throw error;
      onRetry?.(error, attempt + 1);
      const delay = Math.min(minDelayMs * 2 ** attempt, maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}
