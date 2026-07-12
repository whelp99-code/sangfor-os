// 컬러 게이트 LLM 검증 — 도메인 AI 산출물(제안서)을 review 모델로 5-렌즈 실판정한다.
// 결정형 게이트(color-gate.ts)가 후보 신호로 판정하는 것과 달리, 이쪽은 생성된
// 산출물의 내용을 실제 LLM(cx/*-review)이 냉정하게 비평해 pass/fail + 근거를 낸다.
import { meteredChatCompletion } from "../platform/llm-metering";
import { withBackoff } from "../mail/ai-classify-batch";

export type LensVerdict = { pass: boolean; note: string };
export type LensKey = "blue" | "red" | "orange" | "gray" | "teal";

export type ColorGateVerdict = {
  lenses: Record<LensKey, LensVerdict>;
  pass: boolean;
  summary: string;
  mode: "llm";
  model: string;
};

export interface VerifyColorGateInput {
  domain: string;
  title: string;
  bodyMarkdown: string;
  customerName?: string;
  contextNote?: string;
}

const LENS_DEF = `- blue(기술): 기술 타당성·실행 가능성
- red(리스크): 견적/계약/보안/일정 리스크와 그 대응
- orange(가치): 고객 페인 부합·차별점·성공지표 (구체적 마진·금액이 컨텍스트에 없어 "확인 필요"로 남긴 것은 허용하되, 가치 서사 자체는 있어야 함)
- gray(근거): 컨텍스트의 사실을 정확·구체적으로 활용했는지 + 논리 완결성 (명시적 "확인 필요" 표기 자체는 감점 아님)
- teal(UX): 고객 전달 명료성·구조`;

/** 검증(review)용 모델 — 생성 모델과 분리(OPENAI_REVIEW_MODEL). */
export function reviewModel(): string {
  return (
    process.env.OPENAI_REVIEW_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "cx/gpt-5.4-mini-review"
  );
}

function lens(v: unknown): LensVerdict {
  const o = (v ?? {}) as { pass?: unknown; note?: unknown };
  return { pass: Boolean(o.pass), note: typeof o.note === "string" ? o.note : "" };
}

/** review 모델의 json 응답을 ColorGateVerdict 로 파싱(코드펜스 제거 포함). */
export function parseColorGateVerdict(rawText: string, model: string): ColorGateVerdict {
  const stripped = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const p = JSON.parse(stripped) as Record<string, unknown>;
  const lenses: Record<LensKey, LensVerdict> = {
    blue: lens(p.blue),
    red: lens(p.red),
    orange: lens(p.orange),
    gray: lens(p.gray),
    teal: lens(p.teal),
  };
  const keys: LensKey[] = ["blue", "red", "orange", "gray", "teal"];
  const pass =
    typeof p.pass === "boolean" ? p.pass : keys.every((k) => lenses[k].pass);
  return {
    lenses,
    pass,
    summary: typeof p.summary === "string" ? p.summary : "",
    mode: "llm",
    model,
  };
}

/** 생성된 제안서를 review 모델로 5-렌즈 검증. deps.callLLM 로 테스트 주입 가능. */
export async function verifyProposalColorGate(
  input: VerifyColorGateInput,
  deps?: { callLLM?: (system: string, user: string) => Promise<string> },
): Promise<ColorGateVerdict> {
  const model = reviewModel();

  const system = `당신은 한국 B2B 제안서 품질 검증 AI입니다. 이 제안서는 최종 출판본이 아니라, 사람(지휘관)의 검토·승인으로 넘어갈 AI 초안입니다. "출판 완성도"가 아니라 "사람 검토로 넘길 만한 견실한 초안인지"를 기준으로 아래 5개 렌즈로 평가하세요.
${LENS_DEF}

[정직성 규칙 — 중요]
이 제안서는 함께 제공된 컨텍스트(딜의 실제 메일 타임라인 + 제품 지식)에 근거해 작성됩니다. 검증 시 제안서를 그 컨텍스트와 대조하세요.
- 컨텍스트에 없는 수치·사실을 명시적으로 "확인 필요"로 남긴 것은 정직한 표기이며 감점 사유가 아닙니다. 초안 단계에서 미확정 항목이 있는 것은 정상입니다.
- pass=false 감점은 다음에만 적용하세요: ①컨텍스트에 없는 값을 지어냄(환각) ②컨텍스트에 있는 정보를 누락하거나 "확인 필요"로 회피 ③논리 모순·근거 없는 단정 ④구조·서사·핵심 내용의 부재.
- 단, "확인 필요"가 과도해 제안서에 실질 알맹이가 거의 없다면(핵심 대부분 미확정) 그것은 근거 부재로 fail입니다.

각 렌즈마다 pass(boolean)와 note(한국어 한 문장 근거)를 판정하고, 전체 pass(모든 렌즈가 "사람 검토로 넘길 초안" 수준인지)와 summary(한 문장)를 매기세요.
반드시 아래 json 형식으로만 응답하세요:
{"blue":{"pass":true,"note":"..."},"red":{"pass":true,"note":"..."},"orange":{"pass":true,"note":"..."},"gray":{"pass":true,"note":"..."},"teal":{"pass":true,"note":"..."},"pass":true,"summary":"..."}`;

  const customerPart = input.customerName ? `\n고객사: ${input.customerName}` : "";
  const ctx = input.contextNote ? `\n컨텍스트: ${input.contextNote}` : "";
  const user = `도메인: ${input.domain}${customerPart}${ctx}
제안서 제목: ${input.title}
제안서 본문:
${input.bodyMarkdown.slice(0, 4000)}

위 제안서를 5렌즈로 검증해 json으로 판정하세요.`;

  let rawText: string;
  if (deps?.callLLM) {
    rawText = await deps.callLLM(system, user);
  } else {
    rawText = await withBackoff(() =>
      meteredChatCompletion({
        caller: `color-gate:${input.domain}`,
        model,
        jsonMode: true,
        maxCompletionTokens: 900,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    );
  }

  return parseColorGateVerdict(rawText, model);
}
