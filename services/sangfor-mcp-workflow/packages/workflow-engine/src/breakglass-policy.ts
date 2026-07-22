/** U028: break-glass is a manual root-governed process, never a local bypass. */
import type { AuthContext } from '../../shared/src/mutation-policy.js';

export type BreakGlassStatus = 'pending' | 'approved' | 'expired' | 'revoked' | 'used';
export interface BreakGlassRequest { id: string; reason: string; requestedBy: string; requestedAt: string; status: BreakGlassStatus; expiresAt: string; metadata: Record<string, unknown>; }
export interface BreakGlassAuditEntry { requestId: string; action: 'requested' | 'approved' | 'denied' | 'expired' | 'revoked' | 'used'; actor: string; at: string; details: string; }
export interface BreakGlassConfig { defaultDurationMinutes: number; maxDurationMinutes: number; approvalRequired: boolean; expirationCheckIntervalMs: number; }

export class BreakGlassDisabledError extends Error { readonly code = 'manual_gate' as const; constructor() { super('manual-gate: break-glass is disabled in the workflow adapter'); this.name = 'BreakGlassDisabledError'; } }
const disabled = (): never => { throw new BreakGlassDisabledError(); };

export class BreakGlassPolicy {
  constructor(_config?: Partial<BreakGlassConfig>) {}
  requestBreakGlass(_reason: string, _actor: AuthContext, _duration?: number): BreakGlassRequest { return disabled(); }
  approveBreakGlass(_id: string, _actor: AuthContext): BreakGlassRequest { return disabled(); }
  denyBreakGlass(_id: string, _actor: AuthContext, _reason: string): BreakGlassRequest { return disabled(); }
  revokeBreakGlass(_id: string, _actor: AuthContext, _reason: string): BreakGlassRequest { return disabled(); }
  isBreakGlassActive(): boolean { return false; }
  isRequestActive(_id: string): boolean { return false; }
  getActiveSessions(): BreakGlassRequest[] { return []; }
  expireStaleSessions(): number { return 0; }
  getAuditLog(_id?: string): BreakGlassAuditEntry[] { return []; }
  getAllRequests(): BreakGlassRequest[] { return []; }
  getRequest(_id: string): BreakGlassRequest | null { return null; }
  dispose(): void {}
}
