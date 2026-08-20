/**
 * The Intents Explorer API: read-only history of your swaps.
 *
 * Where the other clients answer "what is happening with this one swap",
 * this answers "what happened across all of them": support lookups,
 * reconciliation, and volume reporting. It is the same data the Explorer UI
 * shows, keyed the same way (deposit address).
 *
 * Two things shape how it must be used:
 *
 *   Rate limit   one request every 5 seconds per partner id, 429 beyond that.
 *                This client paces itself, so a multi-page scan cannot
 *                trip the limit halfway through.
 *   Pagination   cursor-based, not offset-based. You resume from the last row
 *                you saw, so new rows arriving mid-scan cannot shift pages
 *                and cause skipped or duplicated results.
 */
import { HttpClient } from './http';
import { EXPLORER_API_BASE_URL, EXPLORER_MIN_REQUEST_INTERVAL_MS } from '../config/constants';
import { ExplorerTransaction, ExplorerTransactionsQuery, ExplorerTransactionsResponse } from '../types/explorer';
import { logger } from '../utils/logger';
import { sleep } from '../utils/retry';

export interface ExplorerClientOptions {
  baseUrl?: string;
  /** Partner JWT from the Partner Dashboard, the same one 1Click uses */
  jwt: string;
  retries?: number;
  timeoutMs?: number;
  /** Override the self-imposed spacing between requests */
  minRequestIntervalMs?: number;
}

export class ExplorerClient {
  private readonly http: HttpClient;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;

  constructor(options: ExplorerClientOptions) {
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? EXPLORER_API_BASE_URL,
      bearerToken: options.jwt,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
    });
    this.minIntervalMs = options.minRequestIntervalMs ?? EXPLORER_MIN_REQUEST_INTERVAL_MS;
  }

  /**
   * Spaces requests out to stay under the documented limit. Waiting here is
   * cheaper than being rate limited and retried, and it keeps a long page
   * scan from tripping the limit halfway through.
   */
  private async throttle(): Promise<void> {
    const waitMs = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (waitMs > 0) {
      logger.debug(`Explorer rate limit: waiting ${waitMs}ms`);
      await sleep(waitMs);
    }
    this.lastRequestAt = Date.now();
  }

  /** GET /transactions. One page, filtered. */
  async getTransactions(query: ExplorerTransactionsQuery = {}): Promise<ExplorerTransaction[]> {
    await this.throttle();
    const response = await this.http.get<ExplorerTransactionsResponse | ExplorerTransaction[]>('/transactions', {
      query: query as Record<string, string | number | undefined>,
    });
    // Tolerate either a bare array or an envelope, so a change in shape does
    // not break callers.
    if (Array.isArray(response)) return response;
    return response.transactions ?? [];
  }

  /**
   * Pages through the full result set, yielding one transaction at a time and
   * respecting the rate limit between pages.
   *
   * Each page resumes from the last row's depositAddress and depositMemo
   * rather than an offset.
   *
   * @param maxPages a stop so an unbounded history cannot loop forever
   */
  async *iterateTransactions(
    query: ExplorerTransactionsQuery = {},
    maxPages = 20,
  ): AsyncGenerator<ExplorerTransaction> {
    const pageSize = query.numberOfTransactions ?? 100;
    let cursor: Pick<ExplorerTransactionsQuery, 'lastDepositAddress' | 'lastDepositMemo'> = {
      lastDepositAddress: query.lastDepositAddress,
      lastDepositMemo: query.lastDepositMemo,
    };

    for (let page = 0; page < maxPages; page++) {
      const rows = await this.getTransactions({
        ...query,
        ...cursor,
        numberOfTransactions: pageSize,
        direction: 'next',
      });
      for (const row of rows) yield row;

      // A short page means there is nothing after it.
      if (rows.length < pageSize) return;

      const last = rows[rows.length - 1];
      cursor = { lastDepositAddress: last.depositAddress, lastDepositMemo: last.depositMemo ?? undefined };
    }
    logger.warn(`Explorer paging stopped at maxPages=${maxPages}; raise it to continue`);
  }

  /**
   * GET /partner-any-quotes. Your standing ANY_INPUT collection addresses.
   *
   * ANY_INPUT quotes run indefinitely rather than expiring, so this is how
   * you enumerate the ones you have open.
   */
  async getPartnerAnyQuotes(): Promise<ExplorerTransaction[]> {
    await this.throttle();
    const response = await this.http.get<ExplorerTransactionsResponse | ExplorerTransaction[]>('/partner-any-quotes');
    if (Array.isArray(response)) return response;
    return response.transactions ?? [];
  }

  /**
   * Convenience lookup for support: find one swap by its deposit address.
   * Returns undefined rather than throwing when there is no match.
   */
  async findByDepositAddress(depositAddress: string, depositMemo?: string): Promise<ExplorerTransaction | undefined> {
    const rows = await this.getTransactions({ search: depositAddress, depositMemo, numberOfTransactions: 10 });
    return rows.find((row) => row.depositAddress === depositAddress);
  }
}
