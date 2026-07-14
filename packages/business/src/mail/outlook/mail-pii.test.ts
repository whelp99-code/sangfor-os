import { describe, expect, it } from "vitest";

import { maskPii } from "./mail-pii";

describe("maskPii", () => {
  it("masks the mobile numbers that signatures leak", () => {
    expect(maskPii("이영호팀장 010-3445-4858")).toBe("이영호팀장 [휴대폰]");
    expect(maskPii("조남일 01062828985")).toBe("조남일 [휴대폰]");
    expect(maskPii("Cell +82 10-7157-7278")).toBe("Cell [휴대폰]");
  });

  it("masks landlines, business numbers, and resident numbers", () => {
    expect(maskPii("대표 02-1234-5678")).toBe("대표 [전화]");
    expect(maskPii("사업자 123-45-67890")).toBe("사업자 [사업자번호]");
    expect(maskPii("주민 900101-1234567")).toBe("주민 [주민번호]");
  });

  it("masks a customer site address", () => {
    expect(maskPii("세븐럭카지노, 서울 용산구 청파로20길 95 5층 방문")).toContain("[주소]");
    expect(maskPii("서울 용산구 청파로20길 95")).not.toContain("청파로");
  });

  it("keeps the surrounding text so the writing style survives", () => {
    const masked = maskPii("안녕하세요\n베를로 박재민입니다 .\n연락처: 010-1111-2222\n감사합니다 .");
    expect(masked).toContain("베를로 박재민입니다 .");
    expect(masked).toContain("감사합니다 .");
    expect(masked).toContain("연락처: [휴대폰]");
  });

  it("leaves ordinary text and product model numbers alone", () => {
    expect(maskPii("M5400-AC-I 장비 2대 견적")).toBe("M5400-AC-I 장비 2대 견적");
    expect(maskPii("Ticket#20260701860005 확인 요청")).toBe("Ticket#20260701860005 확인 요청");
  });
});
