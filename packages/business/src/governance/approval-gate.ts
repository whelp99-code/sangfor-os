export type ApprovalState =
  | 'pending' | 'auto_validating' | 'auto_failed'
  | 'remediation_required' | 'ready_for_human_approval'
  | 'approved' | 'rejected' | 'stale'
  | 'override_requested' | 'override_approved'

export class ApprovalStateMachine {
  private static TRANSITIONS: Record<ApprovalState, ApprovalState[]> = {
    pending: ['auto_validating'],
    auto_validating: ['auto_failed', 'ready_for_human_approval'],
    auto_failed: ['remediation_required', 'override_requested'],
    remediation_required: ['auto_validating'],
    ready_for_human_approval: ['approved', 'rejected', 'stale'],
    approved: [],
    rejected: [],
    stale: ['ready_for_human_approval'],
    override_requested: ['override_approved', 'rejected'],
    override_approved: ['ready_for_human_approval'],
  }

  static canTransition(from: ApprovalState, to: ApprovalState): boolean {
    return this.TRANSITIONS[from]?.includes(to) ?? false
  }

  static validateTransition(from: ApprovalState, to: ApprovalState): void {
    if (!this.canTransition(from, to)) {
      throw new Error(`Invalid approval transition: ${from} → ${to}`)
    }
  }
}

export interface GateRule {
  gateKey: string
  name: string
  check: (data: GateCheckData) => GateResult
}

export interface GateCheckData {
  marginPct: number
  discountPct: number
  opportunityValue: number
  daysToRenewal?: number
}

export interface GateResult {
  passed: boolean
  message?: string
}

export const GATES: GateRule[] = [
  { gateKey: 'G1', name: 'Opportunity Gate', check: (d) => ({ passed: d.marginPct >= 15 || d.opportunityValue < 10000, message: d.marginPct < 15 ? '마진율 15% 미만' : undefined }) },
  { gateKey: 'G2', name: 'Solution Fit Gate', check: (d) => ({ passed: true }) },
  { gateKey: 'G3', name: 'Commercial Gate', check: (d) => ({ passed: d.discountPct <= 25, message: d.discountPct > 25 ? '할인율 25% 초과' : undefined }) },
  { gateKey: 'G4', name: 'Proposal Gate', check: (d) => ({ passed: true }) },
  { gateKey: 'G5', name: 'PoC Gate', check: (d) => ({ passed: true }) },
  { gateKey: 'G6', name: 'Delivery Gate', check: (d) => ({ passed: true }) },
  { gateKey: 'G7', name: 'Acceptance Gate', check: (d) => ({ passed: true }) },
  { gateKey: 'G8', name: 'Renewal Gate', check: (d) => ({ passed: d.daysToRenewal === undefined || d.daysToRenewal >= 30, message: d.daysToRenewal !== undefined && d.daysToRenewal < 30 ? '갱신까지 30일 미만' : undefined }) },
]

export function runAutoValidation(data: GateCheckData): { results: GateResult[]; passed: boolean; failedGates: string[] } {
  const results = GATES.map(g => ({ gateKey: g.gateKey, name: g.name, result: g.check(data) }))
  const failed = results.filter(r => !r.result.passed)
  return { results: results.map(r => r.result), passed: failed.length === 0, failedGates: failed.map(r => r.gateKey) }
}

export function autoTransition(currentState: ApprovalState, validation: { passed: boolean }): ApprovalState {
  if (currentState !== 'pending') return currentState
  return validation.passed ? 'ready_for_human_approval' : 'auto_failed'
}

export { ensureApprovalForRun, createApprovalIfNeeded, approveRequest, submitCommercialApproval } from "./approval-db";
