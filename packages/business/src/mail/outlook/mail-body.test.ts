import { describe, expect, it } from "vitest";

import { extractMailBody } from "./mail-body";

describe("extractMailBody", () => {
  it("returns nothing when Graph gave no body", () => {
    expect(extractMailBody(undefined)).toEqual({ body: null, format: null });
    expect(extractMailBody({ contentType: "html", content: "" })).toEqual({
      body: null,
      format: null,
    });
  });

  it("renders HTML to text", () => {
    const { body, format } = extractMailBody({
      contentType: "html",
      content:
        "<html><style>p{color:red}</style><body><p>견적 요청드립니다.</p><p>납기는 2주입니다.</p></body></html>",
    });
    expect(format).toBe("html");
    expect(body).toBe("견적 요청드립니다.\n납기는 2주입니다.");
  });

  it("drops the quoted previous mail so a thread does not repeat itself", () => {
    const { body } = extractMailBody({
      contentType: "text",
      content: [
        "확인했습니다. 3천만원으로 진행하시죠.",
        "",
        "-----Original Message-----",
        "From: partner@nexias.co.kr",
        "견적 요청드립니다.",
      ].join("\n"),
    });
    expect(body).toBe("확인했습니다. 3천만원으로 진행하시죠.");
  });

  it("cuts the Korean quote header too", () => {
    const { body } = extractMailBody({
      contentType: "text",
      content: "회신드립니다.\n\n보낸 사람: srm@gsitm.com\n원문 내용",
    });
    expect(body).toBe("회신드립니다.");
  });

  it("strips a trailing signature", () => {
    const { body } = extractMailBody({
      contentType: "text",
      content: "라이선스 연장 진행하겠습니다.\n\n감사합니다.\n박정민 드림\n010-0000-0000",
    });
    expect(body).toBe("라이선스 연장 진행하겠습니다.");
  });

  it("decodes entities and collapses blank runs", () => {
    const { body } = extractMailBody({
      contentType: "html",
      content: "<div>A&nbsp;&amp;&nbsp;B</div><br><br><br><div>C</div>",
    });
    expect(body).toBe("A & B\n\nC");
  });
});
