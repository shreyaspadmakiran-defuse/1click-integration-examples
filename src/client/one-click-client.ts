import { HttpClient } from './http';
import { ONE_CLICK_BASE_URL } from '../config/constants';
import {
  AccountBalance,
  AccountHistoryEntry,
  AnyInputWithdrawalsResponse,
  AuthenticateRequest,
  AuthenticateResponse,
  ExecutionStatus,
  GenerateIntentRequest,
  GenerateIntentResponse,
  QuoteRequest,
  QuoteResponse,
  RefreshResponse,
  SubmitDepositTxRequest,
  SubmitIntentRequest,
  SubmitIntentResponse,
  TokenInfo,
} from '../types/one-click';

export interface OneClickClientOptions {
  baseUrl?: string;
  /** Partner JWT. Without it, quotes carry a 0.2% platform fee */
  jwt?: string;
  /** Partner API key for /v0/generate-intent and /v0/submit-intent */
  apiKey?: string;
  retries?: number;
  timeoutMs?: number;
}

/**
 * Typed client for every 1Click API route. Each method maps 1:1 to an
 * endpoint; the README explains when and where to call each one.
 */
export class OneClickClient {
  private readonly http: HttpClient;

  constructor(options: OneClickClientOptions = {}) {
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? ONE_CLICK_BASE_URL,
      bearerToken: options.jwt,
      apiKey: options.apiKey,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * GET /v0/tokens. Public. Call it first (and cache it) to discover
   * assetIds, decimals, and USD prices for every supported token.
   */
  getTokens(): Promise<TokenInfo[]> {
    return this.http.get<TokenInfo[]>('/v0/tokens');
  }

  /**
   * POST /v0/quote. The first required step of every swap.
   * dry=true simulates (no deposit address, safe to call freely);
   * dry=false commits and returns the depositAddress to fund.
   * Dry quotes are retried on transient failures, real quotes are not.
   *
   * Confidential quotes (depositType or recipientType CONFIDENTIAL_INTENTS)
   * additionally require the end user's User-Session token from
   * authenticate(), because pricing them reads a private balance. The partner
   * JWT is not enough and the request fails with 401 without it.
   */
  getQuote(request: QuoteRequest, userAccessToken?: string): Promise<QuoteResponse> {
    return this.http.post<QuoteResponse>('/v0/quote', {
      body: request,
      idempotent: request.dry,
      bearerToken: userAccessToken,
    });
  }

  /**
   * GET /v0/status. Poll after funding a quote. Pass depositMemo whenever
   * the quote response included one, otherwise the lookup 404s.
   */
  getStatus(depositAddress: string, depositMemo?: string): Promise<ExecutionStatus> {
    return this.http.get<ExecutionStatus>('/v0/status', { query: { depositAddress, depositMemo } });
  }

  /**
   * POST /v0/deposit/submit. Optional accelerator for ORIGIN_CHAIN swaps:
   * tell 1Click your deposit tx hash so it does not have to discover it.
   */
  submitDepositTx(request: SubmitDepositTxRequest): Promise<ExecutionStatus> {
    return this.http.post<ExecutionStatus>('/v0/deposit/submit', { body: request });
  }

  /**
   * GET /v0/any-input/withdrawals. Only for ANY_INPUT quotes: lists the
   * periodic sweeps from a collection address, with paging and sorting.
   */
  getAnyInputWithdrawals(params: {
    depositAddress: string;
    depositMemo?: string;
    timestampFrom?: string;
    page?: number;
    limit?: number;
    sortOrder?: 'asc' | 'desc';
  }): Promise<AnyInputWithdrawalsResponse> {
    return this.http.get<AnyInputWithdrawalsResponse>('/v0/any-input/withdrawals', { query: { ...params } });
  }

  /**
   * POST /v0/generate-intent. For depositType INTENTS or CONFIDENTIAL_INTENTS:
   * returns the unsigned intent payload the user's wallet must sign.
   * Requires partner auth (X-API-Key).
   */
  generateIntent(request: GenerateIntentRequest): Promise<GenerateIntentResponse> {
    return this.http.post<GenerateIntentResponse>('/v0/generate-intent', { body: request });
  }

  /**
   * POST /v0/submit-intent. Submits the signed MultiPayload produced from
   * the generated intent. Never retried automatically: a retry after an
   * ambiguous failure could double-submit. Requires partner auth (X-API-Key).
   */
  submitIntent(request: SubmitIntentRequest): Promise<SubmitIntentResponse> {
    return this.http.post<SubmitIntentResponse>('/v0/submit-intent', { body: request });
  }

  /**
   * POST /v0/auth/authenticate. Exchanges a wallet-signed empty-intents
   * payload for a User-Session token (needed for confidential balances).
   */
  authenticate(request: AuthenticateRequest): Promise<AuthenticateResponse> {
    return this.http.post<AuthenticateResponse>('/v0/auth/authenticate', { body: request });
  }

  /** POST /v0/auth/refresh. Renews an expired accessToken without re-signing. */
  refresh(refreshToken: string): Promise<RefreshResponse> {
    return this.http.post<RefreshResponse>('/v0/auth/refresh', { body: { refreshToken } });
  }

  /**
   * GET /v0/account/balances. Requires a User-Session accessToken
   * (not the partner JWT): balances are private to the account owner.
   */
  getBalances(userAccessToken: string): Promise<AccountBalance[]> {
    return this.http.get<AccountBalance[]>('/v0/account/balances', { bearerToken: userAccessToken });
  }

  /**
   * GET /v0/account/history. The account owner's own swap history, so it
   * also needs the User-Session accessToken rather than the partner JWT.
   *
   * Not to be confused with the Explorer API, which returns YOUR history as
   * an integrator across all users. This one is scoped to one account.
   */
  getHistory(userAccessToken: string, query: { page?: number; limit?: number } = {}): Promise<AccountHistoryEntry[]> {
    return this.http.get<AccountHistoryEntry[]>('/v0/account/history', {
      bearerToken: userAccessToken,
      query: { ...query },
    });
  }
}
