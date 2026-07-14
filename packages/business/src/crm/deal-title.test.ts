import { describe, expect, it } from "vitest";

import { mailCandidateNextAction, normalizeDealTitle, withTag } from "./deal-title";

describe("mailCandidateNextAction", () => {
  it("replaces the English copy and truncates the mail dump that filled the cell", () => {
    const summary = "대화 1건 (받은 1 / 보낸 0) ".repeat(20);
    const action = mailCandidateNextAction(summary);
    expect(action.startsWith("승인된 메일 후보 검토 — ")).toBe(true);
    expect(action).not.toMatch(/Review approved mail candidate/);
    expect(action.length).toBeLessThanOrEqual("승인된 메일 후보 검토 — ".length + 60);
  });

  it("drops the dash when there is no summary to show", () => {
    expect(mailCandidateNextAction("   ")).toBe("승인된 메일 후보 검토");
  });

  it("cuts at the mail transcript instead of slicing addresses into the cell", () => {
    const summary =
      "대화 1건 (받은 1 / 보낸 0).\n[받은] srm@gsitm.com → jm.park@blro.co.kr: 견적 요청드립니다";
    expect(mailCandidateNextAction(summary)).toBe("승인된 메일 후보 검토 — 대화 1건 (받은 1 / 보낸 0).");
  });
});

describe("normalizeDealTitle", () => {
  it("strips a mail reply prefix", () => {
    expect(normalizeDealTitle("RE: Sangfor vGPU Node 추가 관련 사전 검토 요청 드립니다.")).toEqual({
      title: "Sangfor vGPU Node 추가 관련 사전 검토 요청 드립니다.",
      tag: null,
    });
    expect(normalizeDealTitle("FW: aDesk 업데이트 이후 라이선스 문제 확인 요청 드립니다.").title).toBe(
      "aDesk 업데이트 이후 라이선스 문제 확인 요청 드립니다.",
    );
  });

  it("strips nested prefixes, which prod actually has", () => {
    expect(normalizeDealTitle("Fwd: Re: [넥시아스] 아이티네이드 - 간략 VDI 하드웨어 사이징")).toEqual({
      title: "아이티네이드 - 간략 VDI 하드웨어 사이징",
      tag: "넥시아스",
    });
    expect(normalizeDealTitle("Re: Re: [넥시아스] 베를로 - 디알비동일 Sangfor Term License").tag).toBe(
      "넥시아스",
    );
  });

  it("separates the leading bracket tag without discarding it", () => {
    expect(normalizeDealTitle("[SNET 구매포탈] 견적 요청")).toEqual({
      title: "견적 요청",
      tag: "SNET 구매포탈",
    });
    expect(withTag(normalizeDealTitle("[SNET 구매포탈] 견적 요청"))).toBe("[SNET 구매포탈] 견적 요청");
  });

  it("collapses the duplicated fragment seen on the 인카금융서비스 deal", () => {
    expect(
      normalizeDealTitle(
        "[넥시아스] 베를로 - 인카금융서비스넥시아스] 베를로 - 인카금융서비스 서비스레터/라이선스 전달",
      ),
    ).toEqual({
      title: "베를로 - 인카금융서비스 서비스레터/라이선스 전달",
      tag: "넥시아스",
    });
  });

  it("leaves a clean title untouched", () => {
    expect(normalizeDealTitle("KB손해사정 - 서버가상화")).toEqual({
      title: "KB손해사정 - 서버가상화",
      tag: null,
    });
  });

  it("does not strip a legitimate word that merely starts with the prefix letters", () => {
    expect(normalizeDealTitle("Renewal 견적 요청").title).toBe("Renewal 견적 요청");
    expect(normalizeDealTitle("전달사항 정리").title).toBe("전달사항 정리");
  });

  it("keeps the raw subject when normalization would empty it", () => {
    expect(normalizeDealTitle("Re: ").title).toBe("Re:");
  });

  it("collapses runs of whitespace", () => {
    expect(normalizeDealTitle("RE:  동국대학교   aServer 견적").title).toBe("동국대학교 aServer 견적");
  });
});
