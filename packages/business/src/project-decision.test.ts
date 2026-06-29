import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@sangfor/db";
import {
  computeAutonomy,
  getDomainAutonomy,
  MIN_AUTONOMY_SAMPLE,
  recordHumanDecision,
} from "./project-decision";

// ─── Pure unit tests (no DB) ──────────────────────────────────────────────────

describe("computeAutonomy (pure)", () => {
  it("empty => {pct:null, sample:0, label:'학습중'}", () => {
    expect(computeAutonomy([])).toEqual({ pct: null, sample: 0, label: "학습중" });
  });

  it("below MIN_AUTONOMY_SAMPLE => 학습중", () => {
    const decisions = Array.from({ length: MIN_AUTONOMY_SAMPLE - 1 }, () => ({
      outcome: "approved",
      hasHumanEdit: false,
    }));
    const result = computeAutonomy(decisions);
    expect(result.pct).toBeNull();
    expect(result.sample).toBe(MIN_AUTONOMY_SAMPLE - 1);
    expect(result.label).toBe("학습중");
  });

  it("4 approved no-edit => pct 100, label '높음'", () => {
    const decisions = Array.from({ length: 4 }, () => ({
      outcome: "approved",
      hasHumanEdit: false,
    }));
    const result = computeAutonomy(decisions);
    expect(result.pct).toBe(100);
    expect(result.sample).toBe(4);
    expect(result.label).toBe("높음");
  });

  it("2 approved-noedit + 2 corrected => pct 50, label '보통'", () => {
    const decisions = [
      { outcome: "approved", hasHumanEdit: false },
      { outcome: "approved", hasHumanEdit: false },
      { outcome: "corrected", hasHumanEdit: true },
      { outcome: "corrected", hasHumanEdit: true },
    ];
    const result = computeAutonomy(decisions);
    expect(result.pct).toBe(50);
    expect(result.sample).toBe(4);
    expect(result.label).toBe("보통");
  });

  it("all corrected => pct 0, label '낮음'", () => {
    const decisions = Array.from({ length: 4 }, () => ({
      outcome: "corrected",
      hasHumanEdit: true,
    }));
    const result = computeAutonomy(decisions);
    expect(result.pct).toBe(0);
    expect(result.sample).toBe(4);
    expect(result.label).toBe("낮음");
  });
});

// ─── Integration tests (CI_INTEGRATION=1) ────────────────────────────────────

const integration = process.env.CI_INTEGRATION === "1";
const TAG = "__hub_phase2_test__";
// Use a fake engagementId — we don't create a real Engagement row; caseRef convention is enough.
const FAKE_ENG_ID = "fake-eng-hub-phase2-test-001";
const CASE_REF = "eng:" + FAKE_ENG_ID;
const MEMORY_KEY = CASE_REF + ":sales";

describe.skipIf(!integration)("recordHumanDecision + getDomainAutonomy (integration)", () => {
  afterAll(async () => {
    // Cleanup decision logs by caseRef
    await prisma.domainDecisionLog.deleteMany({ where: { caseRef: CASE_REF } });
    // Cleanup memories by key
    await prisma.domainMemory.deleteMany({ where: { key: MEMORY_KEY } });
  });

  it("creates a DomainDecisionLog (caseRef, decisionType='human_review') + DomainMemory (source='human') on approved", async () => {
    const { decisionId } = await recordHumanDecision({
      engagementId: FAKE_ENG_ID,
      domain: "sales",
      outcome: "approved",
      output: { proposalText: "대용량 스토리지 제안" },
      note: TAG,
    });

    expect(decisionId).toBeTruthy();

    // Verify DomainDecisionLog row
    const log = await prisma.domainDecisionLog.findUniqueOrThrow({ where: { id: decisionId } });
    expect(log.caseRef).toBe(CASE_REF);
    expect(log.decisionType).toBe("human_review");
    expect(log.outcome).toBe("approved");
    expect(log.domain).toBe("sales");

    // Verify DomainMemory row
    const mem = await prisma.domainMemory.findFirst({ where: { key: MEMORY_KEY } });
    expect(mem).not.toBeNull();
    expect(mem!.source).toBe("human");
    expect(mem!.outcome).toBe("approved");
    expect(mem!.confidence).toBe(90);
  });

  it("getDomainAutonomy reflects the recorded decision", async () => {
    const autonomy = await getDomainAutonomy("sales");
    // sample should be >= 1 (our test row); if < MIN we get 학습중 which is valid
    expect(autonomy.sample).toBeGreaterThan(0);
    // label must be one of the valid values
    expect(["학습중", "높음", "보통", "낮음"]).toContain(autonomy.label);
  });

  it("corrected outcome sets confidence=85 and records humanEdit as memory value", async () => {
    const correction = { proposalText: "수정된 제안: NVMe 기반 솔루션" };
    const { decisionId } = await recordHumanDecision({
      engagementId: FAKE_ENG_ID,
      domain: "sales",
      outcome: "corrected",
      output: { proposalText: "원본 제안" },
      humanEdit: correction,
    });

    const log = await prisma.domainDecisionLog.findUniqueOrThrow({ where: { id: decisionId } });
    expect(log.outcome).toBe("corrected");
    expect(log.humanEditJson).not.toBeNull();

    // memory should now have the corrected value
    const mem = await prisma.domainMemory.findFirst({ where: { key: MEMORY_KEY } });
    expect(mem).not.toBeNull();
    expect(mem!.confidence).toBe(85); // last upsert wins
  });

  it("rejected outcome does NOT create a DomainMemory row (or update existing)", async () => {
    // Count memory rows before
    const countBefore = await prisma.domainMemory.count({ where: { key: MEMORY_KEY } });

    await recordHumanDecision({
      engagementId: FAKE_ENG_ID,
      domain: "sales",
      outcome: "rejected",
      output: { proposalText: "거부된 제안" },
    });

    // Count after — should not have increased
    const countAfter = await prisma.domainMemory.count({ where: { key: MEMORY_KEY } });
    expect(countAfter).toBe(countBefore);
  });
});
