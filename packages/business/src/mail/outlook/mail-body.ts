// Outlook은 회신 시 이전 메일 전체를 본문에 이어붙인다. 인용부를 남기면 같은 문장이
// 스레드 길이만큼 반복돼 학습이 그 반복을 패턴으로 착각한다. 첫 인용 경계에서 끊는다.
const QUOTE_BOUNDARY = [
  /^\s*-{2,}\s*(원본 메시지|Original Message)\s*-{2,}/im,
  /^\s*보낸\s*사람\s*:/im,
  /^\s*From\s*:\s*.+\s*$/im,
  /^\s*_{5,}\s*$/m,
  /^\s*On .+ wrote:\s*$/im,
];

const SIGNATURE_BOUNDARY = /^\s*(--\s*$|감사합니다\.?\s*$|Best regards,?\s*$|Thanks,?\s*$)/im;

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function stripQuotedReply(text: string): string {
  let cut = text.length;
  for (const boundary of QUOTE_BOUNDARY) {
    const match = text.match(boundary);
    if (match?.index !== undefined && match.index < cut) {
      cut = match.index;
    }
  }
  return text.slice(0, cut);
}

export interface ExtractedBody {
  body: string | null;
  format: "text" | "html" | null;
}

/**
 * Graph 본문을 학습에 쓸 평문으로 만든다.
 *
 * 인용된 이전 메일과 서명은 제거한다 — 남기면 한 스레드의 같은 문장이 메일 수만큼
 * 중복되고, 서명(연락처·직함)이 모든 메일에 붙어 빈도 신호를 오염시킨다.
 */
export function extractMailBody(raw: {
  contentType?: string;
  content?: string;
} | undefined): ExtractedBody {
  const content = raw?.content;
  if (!content) return { body: null, format: null };

  const isHtml = (raw?.contentType ?? "").toLowerCase() === "html" || /<[a-z][\s\S]*>/i.test(content);
  const text = isHtml ? htmlToText(content) : content;

  let cleaned = stripQuotedReply(text);
  const signature = cleaned.match(SIGNATURE_BOUNDARY);
  if (signature?.index !== undefined && signature.index > 0) {
    cleaned = cleaned.slice(0, signature.index);
  }

  cleaned = cleaned
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { body: cleaned || null, format: isHtml ? "html" : "text" };
}
