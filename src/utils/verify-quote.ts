import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { QuoteResponse } from '../types/one-click';
import { logger } from '../utils/logger';

/**
 * Verifies that a quote payload was signed by 1Click (Ed25519 over a
 * stable-stringified hash of the request + response + timestamp).
 * Delegates to the official SDK's verifyQuoteSignature.
 * See https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature.
 */
export function verifyQuote(quote: QuoteResponse): boolean {
  try {
    // The SDK's QuoteResponse type is structurally identical
    return verifyQuoteSignature(quote as never);
  } catch (error) {
    logger.warn('Quote signature verification threw, treating as invalid', String(error));
    return false;
  }
}
