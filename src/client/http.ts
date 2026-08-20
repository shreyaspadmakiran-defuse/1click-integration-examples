import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(url: string, status: number, body: unknown) {
    const detail = typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body);
    super(`HTTP ${status} from ${url}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  /** Sent as "Authorization: Bearer <token>" */
  bearerToken?: string;
  /** Sent as "X-API-Key: <key>" */
  apiKey?: string;
  /** Retries for GET requests on 429/5xx/network errors (default 3) */
  retries?: number;
  /** Per-request timeout (default 30s) */
  timeoutMs?: number;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Override the client-level bearer token for this request (used for User-Session tokens) */
  bearerToken?: string;
  /** Allow retrying this request even if it is a POST (safe for dry quotes) */
  idempotent?: boolean;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500;
  return true; // network errors, timeouts
}

/**
 * Small fetch wrapper shared by the 1Click and Shield clients:
 * base URL, auth headers, JSON, timeouts, and retries for idempotent calls.
 */
export class HttpClient {
  private readonly options: HttpClientOptions;

  constructor(options: HttpClientOptions) {
    this.options = options;
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, { ...options, idempotent: true });
  }

  post<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, options);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, options: RequestOptions): Promise<T> {
    const url = new URL(path, this.options.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    const bearer = options.bearerToken ?? this.options.bearerToken;
    if (bearer) headers['authorization'] = `Bearer ${bearer}`;
    if (this.options.apiKey) headers['x-api-key'] = this.options.apiKey;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    const doFetch = async (): Promise<T> => {
      logger.debug(`${method} ${url.toString()}`);
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });

      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        // keep raw text for non-JSON error bodies
      }

      if (!response.ok) throw new ApiError(url.toString(), response.status, parsed);
      return parsed as T;
    };

    if (options.idempotent) {
      return withRetry(doFetch, {
        retries: this.options.retries ?? 3,
        shouldRetry: isRetryable,
        onRetry: (error, attempt) => logger.warn(`Retrying ${method} ${path} (attempt ${attempt})`, String(error)),
      });
    }
    return doFetch();
  }
}
