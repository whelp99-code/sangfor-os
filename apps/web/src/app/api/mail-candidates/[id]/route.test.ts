import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  CandidateConversionInProgressError,
  mockApprove,
  mockGet,
  mockRevalidate,
  mockReject,
  mockSetCandidateType,
} = vi.hoisted(() => ({
  CandidateConversionInProgressError: class extends Error {},
  mockApprove: vi.fn(),
  mockGet: vi.fn(),
  mockRevalidate: vi.fn(),
  mockReject: vi.fn(),
  mockSetCandidateType: vi.fn(),
}));

vi.mock("@sangfor/business/mail-candidates", () => ({
  approveMailDerivedCandidate: mockApprove,
  CandidateConversionInProgressError,
  getMailDerivedCandidate: mockGet,
  revalidateMailDerivedCandidate: mockRevalidate,
  rejectMailDerivedCandidate: mockReject,
  setCandidateType: mockSetCandidateType,
}));

import { PATCH } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/mail-candidates/cand-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function params(id = "cand-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockApprove.mockReset();
  mockGet.mockReset();
  mockRevalidate.mockReset();
  mockReject.mockReset();
  mockSetCandidateType.mockReset();
});

const prevBypass = process.env.AUTH_BYPASS_ENABLED;
beforeAll(() => {
  process.env.AUTH_BYPASS_ENABLED = "1";
});
afterAll(() => {
  process.env.AUTH_BYPASS_ENABLED = prevBypass;
});

describe("PATCH /api/mail-candidates/[id]", () => {
  it("routes action=set_candidate_type to setCandidateType with the target type", async () => {
    mockSetCandidateType.mockResolvedValue({ id: "cand-1", candidateType: "partner" });

    const res = await PATCH(req({ action: "set_candidate_type", candidateType: "partner" }), params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSetCandidateType).toHaveBeenCalledWith("cand-1", { candidateType: "partner" });
    expect(body.candidate).toEqual({ id: "cand-1", candidateType: "partner" });
  });

  it("returns a sanitized 400 when setCandidateType rejects an uncorrectable type", async () => {
    mockSetCandidateType.mockRejectedValue(new Error("candidate_type_not_correctable"));

    const res = await PATCH(req({ action: "set_candidate_type", candidateType: "partner" }), params());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("patch_failed");
    expect(JSON.stringify(body)).not.toContain("candidate_type_not_correctable");
  });

  it("still routes action=approve to approveMailDerivedCandidate", async () => {
    mockApprove.mockResolvedValue({ candidate: { id: "cand-1" }, created: { id: "x" } });

    const res = await PATCH(req({ action: "approve" }), params());

    expect(res.status).toBe(200);
    expect(mockApprove).toHaveBeenCalledWith("cand-1");
  });

  it("returns 409 while another approval is converting the candidate", async () => {
    mockApprove.mockRejectedValueOnce(new CandidateConversionInProgressError());

    const res = await PATCH(req({ action: "approve" }), params());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("candidate_conversion_in_progress");
  });

  it("still routes action=reject to rejectMailDerivedCandidate with reasonCode", async () => {
    mockReject.mockResolvedValue({ id: "cand-1", status: "rejected" });

    const res = await PATCH(req({ action: "reject", reasonCode: "wrong_entity_role" }), params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockReject).toHaveBeenCalledWith("cand-1", { reasonCode: "wrong_entity_role", note: undefined });
    expect(body.candidate).toEqual({ id: "cand-1", status: "rejected" });
  });

  it("returns 400 unsupported_action for an unknown action", async () => {
    const res = await PATCH(req({ action: "bogus" }), params());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unsupported_action");
  });
});
