/**
 * A loaded snapshot of GET /v0/tokens.
 *
 * Every amount in the API is a smallest-unit string, and the only way to know
 * how many decimals that is comes from the token list. Fetching it per call
 * is wasteful and makes conversion errors easy, so load it once and resolve
 * decimals through this.
 */
import { OneClickClient } from '../client/one-click-client';
import { TokenInfo } from '../types/one-click';
import { formatAmount, parseAmount } from './amounts';

export class TokenRegistry {
  private readonly byId: Map<string, TokenInfo>;
  readonly tokens: readonly TokenInfo[];

  constructor(tokens: TokenInfo[]) {
    this.tokens = tokens;
    this.byId = new Map(tokens.map((token) => [token.assetId, token]));
  }

  /** Fetches the token list once and wraps it. */
  static async load(client: OneClickClient): Promise<TokenRegistry> {
    return new TokenRegistry(await client.getTokens());
  }

  find(assetId: string): TokenInfo | undefined {
    return this.byId.get(assetId);
  }

  /** Like find(), but fails loudly with a hint instead of returning undefined. */
  require(assetId: string): TokenInfo {
    const token = this.byId.get(assetId);
    if (!token) {
      throw new Error(`Unknown assetId "${assetId}". List valid ids with client.getTokens().`);
    }
    return token;
  }

  /** Symbols are not unique across chains, so this returns every match. */
  bySymbol(symbol: string): TokenInfo[] {
    const wanted = symbol.toLowerCase();
    return this.tokens.filter((token) => token.symbol.toLowerCase() === wanted);
  }

  onChain(blockchain: string): TokenInfo[] {
    const wanted = blockchain.toLowerCase();
    return this.tokens.filter((token) => token.blockchain.toLowerCase() === wanted);
  }

  decimalsOf(assetId: string): number {
    return this.require(assetId).decimals;
  }

  /** "1.5" -> "1500000" using that asset's decimals */
  parse(human: string, assetId: string): string {
    return parseAmount(human, this.decimalsOf(assetId));
  }

  /** "1500000" -> "1.5" using that asset's decimals */
  format(raw: string, assetId: string): string {
    return formatAmount(raw, this.decimalsOf(assetId));
  }
}
