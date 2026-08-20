/**
 * Read-only view calls against the Intents verifier contract (intents.near).
 *
 * These read contract state directly, answering three things the REST API
 * cannot:
 *
 *   "does the user actually hold this?"  before quoting a depositType INTENTS
 *                                        swap, so you fail early instead of
 *                                        mid-flow
 *   "did my intent land?"                after an ambiguous submit, by nonce.
 *                                        A used nonce is proof of execution.
 *   "would this intent work?"            simulate_intents runs it without
 *                                        touching state
 *
 * Everything here is a view call: no keys, no gas, no state change. Calls go
 * to a public NEAR RPC over JSON-RPC rather than to 1Click.
 */
import { HttpClient } from './http';
import { INTENTS_CONTRACT_ID, NEAR_RPC_URL } from '../config/constants';
import { NearRpcResponse, NearViewCallResult, SimulateIntentsResult } from '../types/intents-contract';
import { SignedIntentData } from '../types/one-click';

export interface IntentsContractClientOptions {
  /** NEAR JSON-RPC endpoint. Any mainnet RPC works; no key required. */
  rpcUrl?: string;
  /** Defaults to intents.near */
  contractId?: string;
  retries?: number;
  timeoutMs?: number;
}

export class IntentsContractClient {
  private readonly http: HttpClient;
  private readonly contractId: string;

  constructor(options: IntentsContractClientOptions = {}) {
    this.http = new HttpClient({
      baseUrl: options.rpcUrl ?? NEAR_RPC_URL,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
    });
    this.contractId = options.contractId ?? INTENTS_CONTRACT_ID;
  }

  /**
   * Executes a view function and decodes the result.
   *
   * NEAR returns the contract's return value as a byte array of UTF-8 JSON,
   * so it needs decoding twice: bytes to string, string to JSON. It also
   * reports failures inside a 200 response, both at the JSON-RPC level and
   * again inside `result.error`, so both are checked here.
   */
  async view<T>(methodName: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await this.http.post<NearRpcResponse<NearViewCallResult>>('/', {
      // View calls are pure reads, so retrying one is always safe.
      idempotent: true,
      body: {
        jsonrpc: '2.0',
        id: 'defuse-1click-example',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: this.contractId,
          method_name: methodName,
          args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        },
      },
    });

    if (response.error) {
      const detail = response.error.cause?.name ?? response.error.message ?? JSON.stringify(response.error);
      throw new Error(`NEAR RPC error calling ${this.contractId}.${methodName}: ${detail}`);
    }
    if (!response.result) {
      throw new Error(`NEAR RPC returned no result for ${this.contractId}.${methodName}`);
    }
    if (response.result.error) {
      throw new Error(`${this.contractId}.${methodName} failed: ${response.result.error}`);
    }

    return JSON.parse(Buffer.from(response.result.result).toString('utf-8')) as T;
  }

  /**
   * Balances for several tokens at once, in smallest units, index-aligned
   * with `tokenIds`. Token ids are 1Click assetIds verbatim.
   *
   * Prefer this over one call per token: it is a single round trip and a
   * single block height, so the numbers are mutually consistent.
   */
  balances(accountId: string, tokenIds: string[]): Promise<string[]> {
    return this.view<string[]>('mt_batch_balance_of', { account_id: accountId, token_ids: tokenIds });
  }

  /** Balance of one token, in smallest units. */
  balance(accountId: string, tokenId: string): Promise<string> {
    return this.view<string>('mt_balance_of', { account_id: accountId, token_id: tokenId });
  }

  /**
   * Whether a nonce has already been consumed.
   *
   * This is the definitive answer to "did my intent execute?" after a
   * timeout. Nonces are single-use, so a used nonce means the intent ran and
   * resubmitting it would be rejected rather than duplicated. Reading this is
   * cheaper and more certain than inferring from swap status.
   */
  isNonceUsed(accountId: string, nonce: string): Promise<boolean> {
    return this.view<boolean>('is_nonce_used', { account_id: accountId, nonce });
  }

  /**
   * Dry-runs signed intents without changing state, returning the intent
   * hashes that would execute, the events that would fire, and the current
   * fee and salt.
   *
   * Useful for validating a signature and deadline before submitting, and for
   * learning an intent hash ahead of time.
   */
  simulateIntents(signed: SignedIntentData[]): Promise<SimulateIntentsResult> {
    return this.view<SimulateIntentsResult>('simulate_intents', { signed });
  }
}
