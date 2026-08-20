import { OneClickClient } from '../client/one-click-client';
import { ShieldClient } from '../client/shield-client';
import { validateQuoteRequest } from '../config/swap-rules';
import { QuoteRequest, QuoteResponse, TokenInfo } from '../types/one-click';
import { ShieldIncident } from '../types/shield';
import { logger } from '../utils/logger';

export interface PreflightResult {
  ok: boolean;
  /** Shield incidents that touch the chains or tokens in this quote */
  blockingIncidents: ShieldIncident[];
  /** The dry quote, present when the quote endpoint accepted the request */
  dryQuote?: QuoteResponse;
  problems: string[];
  /** Legal but probably unintended combinations, e.g. refundTo on an ANY_INPUT swap */
  warnings: string[];
}

function chainOfAsset(assetId: string, tokens: TokenInfo[]): string | undefined {
  return tokens.find((t) => t.assetId === assetId)?.blockchain;
}

/**
 * Run before committing to a swap:
 * 1. Validate the request against the swap-type matrix. This is local, so an
 *    illegal combination (ANY_INPUT over ORIGIN_CHAIN, FLEX_INPUT over
 *    CONFIDENTIAL_INTENTS) is caught without spending a round trip.
 * 2. If a ShieldClient is provided, check active incidents and flag any
 *    that touch the origin or destination chain or token.
 * 3. Fire a dry quote (no deposit address, no commitment) to validate the
 *    request and preview pricing.
 *
 * Callers decide what to do with a non-ok result; nothing is executed here.
 */
export async function preflight(
  oneClick: OneClickClient,
  request: QuoteRequest,
  options: { shield?: ShieldClient; tokens?: TokenInfo[] } = {},
): Promise<PreflightResult> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const blockingIncidents: ShieldIncident[] = [];

  let ruleErrors = 0;
  for (const issue of validateQuoteRequest(request)) {
    if (issue.level === 'error') {
      ruleErrors++;
      problems.push(issue.message);
    } else {
      warnings.push(issue.message);
      logger.warn(issue.message);
    }
  }

  if (options.shield) {
    try {
      const shieldStatus = await options.shield.getIncidents();
      if (shieldStatus.status === 'incidents') {
        const tokens = options.tokens ?? (await oneClick.getTokens());
        const originChain = chainOfAsset(request.originAsset, tokens);
        const destinationChain = chainOfAsset(request.destinationAsset, tokens);
        for (const incident of shieldStatus.incidents ?? []) {
          const hitsChain =
            incident.scopeType === 'chain' && [originChain, destinationChain].includes(incident.scopeValue);
          const hitsToken =
            incident.scopeType === 'token' &&
            [request.originAsset, request.destinationAsset].includes(incident.scopeValue);
          if (hitsChain || hitsToken) {
            blockingIncidents.push(incident);
            problems.push(
              `Shield incident on ${incident.scopeType} ${incident.scopeValue}` +
                (incident.direction ? ` (${incident.direction})` : '') +
                (incident.publicDescription ? `: ${incident.publicDescription}` : ''),
            );
          }
        }
      }
    } catch (error) {
      // Shield being unreachable should not hard-block a swap; surface it instead
      logger.warn('Shield check failed, continuing without it', String(error));
      problems.push(`Shield check failed: ${String(error)}`);
    }
  }

  // A request the matrix already rejects cannot produce a meaningful quote,
  // so do not spend the round trip on it.
  let dryQuote: QuoteResponse | undefined;
  if (ruleErrors === 0) {
    try {
      dryQuote = await oneClick.getQuote({ ...request, dry: true });
    } catch (error) {
      problems.push(`Dry quote rejected: ${String(error)}`);
    }
  }

  return {
    ok: ruleErrors === 0 && blockingIncidents.length === 0 && dryQuote !== undefined,
    blockingIncidents,
    dryQuote,
    problems,
    warnings,
  };
}
