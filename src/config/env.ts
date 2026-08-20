import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { ONE_CLICK_BASE_URL, SHIELD_BASE_URL } from './constants';

export interface AppEnv {
  /** Partner JWT from https://partners.near-intents.org. Optional: without it quotes carry a 0.2% fee */
  oneClickJwt?: string;
  /** Partner API key, used by /v0/generate-intent and /v0/submit-intent (X-API-Key header) */
  oneClickApiKey?: string;
  /** Shield partner JWT (key_type SHIELD) for https://shield.chaindefuser.com/incident */
  shieldToken?: string;
  oneClickBaseUrl: string;
  shieldBaseUrl: string;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Loads env/.env.{NODE_ENV} if present (same convention as the AMM solver example),
 * then falls back to process.env. Everything is optional: public endpoints
 * (/v0/tokens, /v0/quote, /v0/status) work without any credentials.
 */
export function loadEnv(): AppEnv {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv) {
    const file = path.resolve(process.cwd(), 'env', `.env.${nodeEnv}`);
    if (fs.existsSync(file)) {
      dotenv.config({ path: file });
    }
  }
  dotenv.config(); // also picks up a plain .env if present

  const logLevel = (process.env.LOG_LEVEL ?? 'info') as AppEnv['logLevel'];
  if (!['error', 'warn', 'info', 'debug'].includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL "${logLevel}", expected error|warn|info|debug`);
  }

  return {
    oneClickJwt: process.env.ONE_CLICK_JWT || undefined,
    oneClickApiKey: process.env.ONE_CLICK_API_KEY || undefined,
    shieldToken: process.env.SHIELD_TOKEN || undefined,
    oneClickBaseUrl: process.env.ONE_CLICK_BASE_URL || ONE_CLICK_BASE_URL,
    shieldBaseUrl: process.env.SHIELD_BASE_URL || SHIELD_BASE_URL,
    logLevel,
  };
}
