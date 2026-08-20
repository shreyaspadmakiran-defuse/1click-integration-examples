/**
 * Types for read-only view calls against the Intents verifier contract
 * (intents.near). Token ids on the contract are the same strings 1Click uses
 * as assetIds, e.g. "nep141:wrap.near", so a balance lookup needs no mapping.
 */

/** NEAR JSON-RPC envelope for a `query` / `call_function` request */
export interface NearViewCallResult {
  /** The contract's return value, as raw bytes of a UTF-8 JSON string */
  result: number[];
  logs: string[];
  block_height: number;
  block_hash: string;
  /** Present when the contract call itself failed */
  error?: string;
}

export interface NearRpcResponse<T> {
  jsonrpc: string;
  id: string;
  result?: T;
  error?: {
    name?: string;
    code?: number;
    message?: string;
    cause?: { name?: string; info?: unknown };
    data?: unknown;
  };
}

/** One entry of a simulate_intents response */
export interface SimulatedIntent {
  intent_hash: string;
  account_id: string;
  nonce: string;
}

export interface SimulateIntentsResult {
  intents_executed: SimulatedIntent[];
  /** DIP-4 event JSON strings that execution would emit */
  logs: string[];
  /** Earliest deadline across the simulated intents */
  min_deadline: string;
  state: {
    /** Current fee in pips; 100 pips is 0.01% */
    fee: number;
    /** Hex-encoded salt, part of nonce validation */
    current_salt: string;
  };
}
