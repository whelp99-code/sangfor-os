import { describe, expect, it } from "vitest";

import { DOMAIN_CHARTERS, renderCharter } from "./domain-charter";
import { buildDomainPrompt } from "./domain-agent-runtime";

describe("도메인 헌장", () => {
  it("모든 도메인이 회사 맥락과 문체 규칙은 받는다 — 헌장이 없어도", () => {
    for (const domain of ["marketing", "sales", "presales", "engineer", "cfo"] as const) {
      const text = renderCharter(domain);
      expect(text).toContain("국내 유통사");
      expect(text).toContain("베를로 박재민입니다 .");
    }
  });

  it("영업 AI는 SN 없이 견적을 만들지 않도록 지시받는다", () => {
    const text = renderCharter("sales");
    expect(text).toContain("SN 또는 Gateway ID");
    expect(text).toContain("없으면 만들지 말고 되물어라");
  });

  it("영업 AI는 전년 단가를 그대로 쓰지 않도록 경고받는다", () => {
    expect(renderCharter("sales")).toContain("전년 단가를 그대로 쓰지 마라");
  });

  it("기술 AI는 커널·패치를 임의 판단하지 않고 벤더로 올리도록 지시받는다", () => {
    const text = renderCharter("presales");
    expect(text).toContain("커널·펌웨어·디스크·패치");
    expect(text).toContain("벤더");
  });

  // 처음엔 완료 조건을 "상대가 확인 회신을 보냈다"로 정의했으나, 대표 확인 결과 이
  // 회사에서는 확인 회신이 거의 오지 않는다. 그 정의를 두면 AI가 진행된 건을 전부
  // 미종결로 본다. 관측 가능한 실제 신호는 넥시아스 구매요청이다.
  it("완료 조건은 '내가 보냈다'가 아니라 관측 가능한 신호로 정의된다", () => {
    expect(DOMAIN_CHARTERS.sales?.completion).toContain("넥시아스에 구매요청");
    expect(DOMAIN_CHARTERS.cfo?.completion).toContain("입금 확인");
  });

  it("모든 헌장은 사람이 판단해야 할 것을 명시한다", () => {
    for (const charter of Object.values(DOMAIN_CHARTERS)) {
      expect(charter.humanOnly.length).toBeGreaterThan(0);
    }
  });

  it("GSITM은 고객이 아니라 구매대행 파트너로 알려준다", () => {
    expect(renderCharter("sales")).toContain("GSITM은 고객이 아니라");
  });

  it("총판이 제품별로 다르다는 것을 알려준다", () => {
    const text = renderCharter("sales");
    expect(text).toContain("총판은 제품별로 다르다");
    expect(text).toContain("세연아이넷은 케이투스 총판이지만 Sangfor 건에서는 파트너다");
  });

  it("영업 완료 신호는 확인 회신이 아니라 넥시아스 구매요청이다", () => {
    expect(DOMAIN_CHARTERS.sales?.completion).toContain("넥시아스에 구매요청");
  });

  it("재무 AI는 총판 견적을 매출로 잡지 않도록 지시받는다", () => {
    const text = renderCharter("cfo");
    expect(text).toContain("매입가");
    expect(text).toContain("무조건 세금계산서 금액");
  });

  it("실제 프롬프트에 헌장이 실린다", () => {
    const prompt = buildDomainPrompt(
      "sales",
      { id: "c1", subject: "GS건설 HCI 리뉴얼 견적 요청", tags: ["worktype:라이선스갱신"] },
      [],
    );
    expect(prompt).toContain("[직무]");
    expect(prompt).toContain("Cluster ID 또는 디바이스 파일");
    expect(prompt).toContain("[사람이 판단해야 하는 것 — 단독 결정 금지]");
  });
});
