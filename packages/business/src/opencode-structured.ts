import {
  resolveOpencodeBaseUrl,
  buildOpencodeHeaders,
  createOpencodeSession,
  extractAssistantText,
  type OpencodeConfig,
  type OpencodeModel,
} from "./opencode-client";
import type { JsonSchema } from "./domain-artifact-schema";

/**
 * opencode 구조화 출력 — `format: { type:"json_schema", schema }` 로 검증된 JSON 을 받는다.
 * 응답 경로: info.structured_output. 모델이 wrap 한 경우를 대비해 텍스트 JSON 추출도 폴백.
 */

export class StructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/** LLM 텍스트에서 첫 JSON 객체를 추출 (format 미지원/우회 폴백). */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function fetchOf(cfg?: OpencodeConfig): typeof fetch {
  const f = cfg?.fetchImpl ?? globalThis.fetch;
  if (!f) throw new Error("opencode-structured: no fetch implementation available");
  return f;
}

/** 세션에 구조화 프롬프트를 보내고 검증된 객체를 반환. */
export async function opencodePromptStructured(
  input: {
    sessionID: string;
    model: OpencodeModel;
    prompt: string;
    schema: JsonSchema;
    system?: string;
  } & OpencodeConfig,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    model: input.model,
    parts: [{ type: "text", text: input.prompt }],
    format: { type: "json_schema", schema: input.schema },
  };
  if (input.system) body.system = input.system;

  const res = await fetchOf(input)(
    `${resolveOpencodeBaseUrl(input)}/session/${encodeURIComponent(input.sessionID)}/message`,
    { method: "POST", headers: buildOpencodeHeaders(input), body: JSON.stringify(body) },
  );
  if (!res.ok) throw new StructuredOutputError(`opencode structured prompt failed: ${res.status} ${res.statusText}`);

  const json = (await res.json()) as {
    info?: {
      structured?: Record<string, unknown>;
      structured_output?: Record<string, unknown>;
      error?: { name?: string; message?: string };
    };
    parts?: Array<{ type?: string; text?: string }>;
  };

  if (json.info?.error?.name === "StructuredOutputError") {
    throw new StructuredOutputError(json.info.error.message ?? "structured output validation failed");
  }
  // opencode 실제 응답 키는 info.structured (문서의 structured_output 은 폴백).
  const structured = json.info?.structured ?? json.info?.structured_output;
  if (structured && typeof structured === "object") {
    return structured;
  }
  // 폴백: 텍스트에서 JSON 추출
  const text = extractAssistantText(json.parts ?? []);
  const parsed = extractJsonObject(text);
  if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  throw new StructuredOutputError("no structured_output and no parseable JSON in response");
}

/** 세션 생성 + 구조화 프롬프트 한 번에. */
export async function opencodeCompleteStructured(
  input: { model: OpencodeModel; prompt: string; schema: JsonSchema; system?: string; title?: string } & OpencodeConfig,
): Promise<{ data: Record<string, unknown>; sessionID: string }> {
  const session = await createOpencodeSession(input);
  const data = await opencodePromptStructured({ ...input, sessionID: session.id });
  return { data, sessionID: session.id };
}
