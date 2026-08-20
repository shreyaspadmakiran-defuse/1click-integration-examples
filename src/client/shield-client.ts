import { HttpClient } from './http';
import { SHIELD_BASE_URL } from '../config/constants';
import { ShieldStatusResponse, SubmitIncidentRequest, SubmitIncidentResponse } from '../types/shield';

export interface ShieldClientOptions {
  baseUrl?: string;
  /** Partner token with key_type SHIELD from https://partners.near-intents.org/api-keys */
  token: string;
  retries?: number;
  timeoutMs?: number;
}

/**
 * Client for the Shield Incident API. Shield is the risk layer in front of
 * NEAR Intents; incidents pause evaluation for a scope (chain, bridge,
 * token, or address) and a direction.
 */
export class ShieldClient {
  private readonly http: HttpClient;

  constructor(options: ShieldClientOptions) {
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? SHIELD_BASE_URL,
      bearerToken: options.token,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * GET /incident. Returns { status: "operational" } when clear, or
   * { status: "incidents", incidents: [...] } when something is paused.
   * Check this before quoting or before showing a chain as available.
   */
  getIncidents(): Promise<ShieldStatusResponse> {
    return this.http.get<ShieldStatusResponse>('/incident');
  }

  /**
   * POST /incident. Opens a scoped incident (requires incident permissions
   * granted by Intents Support). Use it when your monitoring detects a
   * problem on a chain, bridge, token, or address you integrate.
   */
  submitIncident(request: SubmitIncidentRequest): Promise<SubmitIncidentResponse> {
    return this.http.post<SubmitIncidentResponse>('/incident', { body: request });
  }
}
