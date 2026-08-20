/**
 * Types for the Shield Incident API (https://shield.chaindefuser.com).
 * See https://docs.near-intents.org/security-compliance/shield-incident-api.
 */

export type ShieldScopeType = 'chain' | 'bridge' | 'token' | 'address';
export type ShieldDirection = 'deposit' | 'withdraw';

export interface ShieldIncident {
  scopeType: ShieldScopeType;
  scopeValue: string;
  direction?: ShieldDirection;
  publicDescription?: string | null;
  /** Fields below are only returned to partners with the status_read grant */
  id?: string;
  status?: string;
  description?: string | null;
  createdBy?: string;
  resolvedBy?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string | null;
}

export interface ShieldStatusResponse {
  status: 'operational' | 'incidents';
  incidents?: ShieldIncident[];
}

export interface SubmitIncidentRequest {
  scopeType: ShieldScopeType;
  scopeValue: string;
  direction?: ShieldDirection;
  description?: string;
}

export interface SubmitIncidentResponse {
  incident: ShieldIncident;
}
