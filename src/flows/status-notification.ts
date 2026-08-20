/**
 * Receiving swap status notifications, as the alternative to polling.
 *
 * 1Click does not publish a webhook payload schema, so this handler is built
 * so the shape does not matter.
 *
 * A notification tells you WHICH swap changed. It never tells you what it
 * changed to, even when the body appears to say so, and the claimed status is
 * never read. The deposit address is extracted, then GET /v0/status supplies
 * the actual state.
 *
 * That yields four properties:
 *   - idempotent: the same notification twice produces the same result, so
 *     at-least-once delivery is safe
 *   - order-independent: a delayed or out-of-order notification cannot move a
 *     swap backwards, because state comes from the authoritative read
 *   - spoof-resistant: a forged body cannot inject a fake SUCCESS, because
 *     the body's claimed status is never trusted
 *   - schema-independent: it keeps working when the payload changes
 *
 * The same handler works for a real webhook, a queue consumer, or a manual
 * "refresh this order" button.
 */
import { OneClickClient } from '../client/one-click-client';
import { ExecutionStatus, SwapStatus, TERMINAL_STATUSES } from '../types/one-click';
import { explainError } from '../utils/errors';
import { logger } from '../utils/logger';
import { OrderStore } from '../utils/order-store';

/** The identifiers extracted from an inbound payload. */
export interface SwapRef {
  depositAddress: string;
  depositMemo?: string;
}

const ADDRESS_KEYS = ['depositAddress', 'deposit_address', 'address'];
const MEMO_KEYS = ['depositMemo', 'deposit_memo', 'memo'];

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Pulls a swap reference out of an arbitrary payload, checking the top level
 * and one level of nesting.
 *
 * Permissive about where the address sits, and uninterested in everything
 * else in the body.
 */
export function extractSwapRef(body: unknown): SwapRef | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;

  const depositAddress = firstString(record, ADDRESS_KEYS);
  if (depositAddress) {
    return { depositAddress, depositMemo: firstString(record, MEMO_KEYS) };
  }

  // Common envelope shapes put the payload under data/payload/swap/event.
  for (const key of ['data', 'payload', 'swap', 'event', 'body']) {
    const nested = record[key];
    if (typeof nested === 'object' && nested !== null) {
      const found = extractSwapRef(nested);
      if (found) return found;
    }
  }
  return undefined;
}

export interface NotificationResult {
  ref: SwapRef;
  /** The authoritative status, read from the API rather than the payload */
  status: ExecutionStatus;
  /** Previous status we had recorded, if any */
  previousStatus?: SwapStatus;
  /** True when this notification actually advanced our record */
  changed: boolean;
  terminal: boolean;
}

export interface NotificationOptions {
  store?: OrderStore;
  /** Called only on a real transition, so it is safe to send email from here */
  onTransition?: (result: NotificationResult) => void | Promise<void>;
}

/**
 * Handles one inbound notification.
 *
 * Throws when the payload carries no usable swap reference, so the caller can
 * answer 400. Any other failure is the caller's cue to answer 5xx and let the
 * sender retry, which is safe precisely because this is idempotent.
 */
export async function handleStatusNotification(
  client: OneClickClient,
  body: unknown,
  options: NotificationOptions = {},
): Promise<NotificationResult> {
  const ref = extractSwapRef(body);
  if (!ref) {
    throw new Error('Notification contained no depositAddress; nothing to look up');
  }

  // The authoritative read. Nothing from `body` is used beyond the
  // identifiers extracted above.
  const status = await client.getStatus(ref.depositAddress, ref.depositMemo);

  const previous = options.store?.get(ref.depositAddress);
  const previousStatus = previous?.status;
  const changed = previousStatus !== status.status;
  const terminal = TERMINAL_STATUSES.includes(status.status);

  const result: NotificationResult = { ref, status, previousStatus, changed, terminal };

  if (options.store) {
    options.store.save({
      depositAddress: ref.depositAddress,
      depositMemo: ref.depositMemo,
      correlationId: status.correlationId,
      status: status.status,
      intentHash: status.swapDetails?.intentHashes?.[0],
      amountOut: status.swapDetails?.amountOut,
    });
  }

  // Fire side effects only on a genuine transition. Without this guard, a
  // redelivered notification emails the user twice.
  if (changed) {
    logger.info(`${ref.depositAddress}: ${previousStatus ?? 'unknown'} -> ${status.status}`);
    await options.onTransition?.(result);
  } else {
    logger.debug(`${ref.depositAddress}: still ${status.status}, no action`);
  }

  return result;
}

/**
 * Wraps the handler for a webhook endpoint, mapping outcomes to status codes.
 *
 * The codes matter for delivery semantics: 400 says "do not bother retrying
 * this", 200 says "handled", 500 says "retry me". Returning 200 on an error
 * would silently drop the update.
 */
export async function handleNotificationRequest(
  client: OneClickClient,
  body: unknown,
  options: NotificationOptions = {},
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  try {
    const result = await handleStatusNotification(client, body, options);
    return {
      statusCode: 200,
      body: {
        depositAddress: result.ref.depositAddress,
        status: result.status.status,
        changed: result.changed,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('no depositAddress')) {
      return { statusCode: 400, body: { error: error.message } };
    }
    // Everything else is retryable from the sender's point of view.
    logger.error(`Notification handling failed: ${explainError(error)}`);
    return { statusCode: 500, body: { error: 'Could not verify swap status, retry' } };
  }
}
