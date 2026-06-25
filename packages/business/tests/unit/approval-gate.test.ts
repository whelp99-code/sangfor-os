import { describe, expect, it } from "vitest";
import {
  ApprovalStateMachine,
  GATES,
  runAutoValidation,
  autoTransition,
  type ApprovalState,
  type GateCheckData,
} from "../../src/approval-gate";

describe("ApprovalStateMachine", () => {
  const ALL_STATES: ApprovalState[] = [
    'pending', 'auto_validating', 'auto_failed',
    'remediation_required', 'ready_for_human_approval',
    'approved', 'rejected', 'stale',
    'override_requested', 'override_approved',
  ]

  describe("valid transitions", () => {
    const valid: [ApprovalState, ApprovalState][] = [
      ['pending', 'auto_validating'],
      ['auto_validating', 'auto_failed'],
      ['auto_validating', 'ready_for_human_approval'],
      ['auto_failed', 'remediation_required'],
      ['auto_failed', 'override_requested'],
      ['remediation_required', 'auto_validating'],
      ['ready_for_human_approval', 'approved'],
      ['ready_for_human_approval', 'rejected'],
      ['ready_for_human_approval', 'stale'],
      ['stale', 'ready_for_human_approval'],
      ['override_requested', 'override_approved'],
      ['override_requested', 'rejected'],
      ['override_approved', 'ready_for_human_approval'],
    ]

    for (const [from, to] of valid) {
      it(`allows ${from} → ${to}`, () => {
        expect(ApprovalStateMachine.canTransition(from, to)).toBe(true)
        expect(() => ApprovalStateMachine.validateTransition(from, to)).not.toThrow()
      })
    }
  })

  describe("invalid transitions", () => {
    it("rejects unknown from state", () => {
      expect(ApprovalStateMachine.canTransition('unknown' as ApprovalState, 'approved')).toBe(false)
    })

    it("terminal states have no outgoing transitions", () => {
      for (const state of ['approved', 'rejected'] as ApprovalState[]) {
        for (const target of ALL_STATES) {
          expect(ApprovalStateMachine.canTransition(state, target)).toBe(false)
        }
      }
    })

    it("pending cannot skip directly to approved", () => {
      expect(ApprovalStateMachine.canTransition('pending', 'approved')).toBe(false)
      expect(() => ApprovalStateMachine.validateTransition('pending', 'approved')).toThrow('Invalid approval transition')
    })

    it("auto_failed cannot go directly to ready_for_human_approval", () => {
      expect(ApprovalStateMachine.canTransition('auto_failed', 'ready_for_human_approval')).toBe(false)
    })

    it("remediation_required cannot go to approved", () => {
      expect(ApprovalStateMachine.canTransition('remediation_required', 'approved')).toBe(false)
    })
  })
})

describe("GATES", () => {
  it("has all 8 gates", () => {
    const keys = GATES.map(g => g.gateKey)
    expect(keys).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'])
  })

  it("G1 fails when margin < 15 and value >= 10000", () => {
    expect(GATES[0].check({ marginPct: 10, discountPct: 0, opportunityValue: 20000 }).passed).toBe(false)
  })

  it("G1 passes when margin >= 15", () => {
    expect(GATES[0].check({ marginPct: 15, discountPct: 0, opportunityValue: 20000 }).passed).toBe(true)
  })

  it("G1 passes when opportunityValue < 10000 even with low margin", () => {
    expect(GATES[0].check({ marginPct: 5, discountPct: 0, opportunityValue: 5000 }).passed).toBe(true)
  })

  it("G3 fails when discount > 25%", () => {
    expect(GATES[2].check({ marginPct: 20, discountPct: 30, opportunityValue: 20000 }).passed).toBe(false)
  })

  it("G3 passes when discount <= 25%", () => {
    expect(GATES[2].check({ marginPct: 20, discountPct: 25, opportunityValue: 20000 }).passed).toBe(true)
  })

  it("G8 fails when daysToRenewal < 30", () => {
    expect(GATES[7].check({ marginPct: 20, discountPct: 10, opportunityValue: 20000, daysToRenewal: 15 }).passed).toBe(false)
  })

  it("G8 passes when daysToRenewal >= 30", () => {
    expect(GATES[7].check({ marginPct: 20, discountPct: 10, opportunityValue: 20000, daysToRenewal: 30 }).passed).toBe(true)
  })

  it("G8 passes when daysToRenewal is undefined", () => {
    expect(GATES[7].check({ marginPct: 20, discountPct: 10, opportunityValue: 20000 }).passed).toBe(true)
  })

  it("G2, G4, G5, G6, G7 always pass", () => {
    const data: GateCheckData = { marginPct: 0, discountPct: 0, opportunityValue: 0 }
    for (const idx of [1, 3, 4, 5, 6]) {
      expect(GATES[idx].check(data).passed).toBe(true)
    }
  })
})

describe("runAutoValidation", () => {
  it("passes when all gates pass", () => {
    const result = runAutoValidation({ marginPct: 20, discountPct: 10, opportunityValue: 5000 })
    expect(result.passed).toBe(true)
    expect(result.failedGates).toEqual([])
  })

  it("fails when gates fail and returns failed gate keys", () => {
    const result = runAutoValidation({ marginPct: 5, discountPct: 50, opportunityValue: 50000 })
    expect(result.passed).toBe(false)
    expect(result.failedGates).toContain('G1')
    expect(result.failedGates).toContain('G3')
  })

  it("returns all results", () => {
    const result = runAutoValidation({ marginPct: 20, discountPct: 10, opportunityValue: 5000 })
    expect(result.results).toHaveLength(8)
  })
})

describe("autoTransition", () => {
  it("transitions from pending to ready_for_human_approval on pass", () => {
    expect(autoTransition('pending', { passed: true })).toBe('ready_for_human_approval')
  })

  it("transitions from pending to auto_failed on fail", () => {
    expect(autoTransition('pending', { passed: false })).toBe('auto_failed')
  })

  it("returns current state when not pending", () => {
    expect(autoTransition('approved', { passed: true })).toBe('approved')
    expect(autoTransition('rejected', { passed: false })).toBe('rejected')
    expect(autoTransition('auto_validating', { passed: true })).toBe('auto_validating')
  })
})
