import { describe, expect, it } from "vitest";

import { DOMAIN_CHARTERS, renderCharter } from "./domain-charter";
import { buildDomainPrompt } from "./domain-agent-runtime";

describe("도메인 헌장", () => {
  it("모든 도메인이 회사 맥락과 문체 규칙은 받는다 — 헌장이 없어도", () => {
    for (const domain of ["marketing", "sales", "presales", "engineer", "cfo"] as const) {
      const text = renderCharter(domain);
      expect(text).toContain("Sangfor 제품의 국내 유통사");
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

  it("완료 조건은 '내가 보냈다'가 아니라 '상대가 확인했다'로 정의된다", () => {
    expect(DOMAIN_CHARTERS.sales?.completion).toContain("상대가 수용·확인");
    expect(DOMAIN_CHARTERS.cfo?.completion).toContain("입금 확인");
  });

  it("모든 헌장은 사람이 판단해야 할 것을 명시한다", () => {
    for (const charter of Object.values(DOMAIN_CHARTERS)) {
      expect(charter.humanOnly.length).toBeGreaterThan(0);
    }
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
