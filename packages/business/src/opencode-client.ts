/**
 * opencode 서버(Go) HTTP 클라이언트.
 *
 * OpenAI 인증은 opencode 가 직접 처리한다 — 사용자가 `opencode auth login` 으로
 * **ChatGPT Plus/Pro 브라우저 OAuth** 를 1회 수행하면 토큰이 ~/.local/share/opencode/auth.json
 * 에 저장된다. 우리는 OAuth/토큰을 구현하지 않고 opencode 서버 API 만 호출한다.
 *
 * 서버: `opencode serve --port 4096 --hostname 127.0.0.1` (OpenAPI: /doc)
 *   POST /session                  → 세션 생성
 *   POST /session/:id/message      → { model:{providerID,modelID}, parts:[{type:"text",text}] } → { info, parts }
 *   GET  /global/health            → 헬스체크
 */

export interface OpencodeConfig {
  /** 기본: env OPENCODE_BASE_URL 또는 http://127.0.0.1:4096 */
  baseUrl?: string;
  /** opencode serve 가 OPENCODE_SERVER_PASSWORD 로 보호된 경우의 basic-auth 비밀번호 */
  password?: string;
  /** basic-auth 사용자명 (기본 빈 문자열). */
  user?: string;
  /** 테스트/주입용 fetch 구현 (기본: 전역 fetch). */
  fetchImpl?: typeof fetch;
}

export interface OpencodeModel {
  providerID: string;
  modelID: string;
}

interface OpencodePart {
  type?: string;
  text?: string;
}

export function resolveOpencodeBaseUrl(cfg?: OpencodeConfig): string {
  return (cfg?.baseUrl ?? process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4096").replace(/\/+$/, "");
}

export function buildOpencodeHeaders(cfg?: OpencodeConfig): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const password = cfg?.password ?? process.env.OPENCODE_SERVER_PASSWORD;
  if (password) {
    const user = cfg?.user ?? process.env.OPENCODE_SERVER_USER ?? "";
    headers.authorization = "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
  }
  return headers;
}

/** 응답 parts 에서 어시스턴트 텍스트만 이어붙인다. */
export function extractAssistantText(parts: OpencodePart[]): string {
  return parts
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("")
    .trim();
}

function fetchOf(cfg?: OpencodeConfig): typeof fetch {
  const f = cfg?.fetchImpl ?? globalThis.fetch;
  if (!f) throw new Error("opencode-client: no fetch implementation available");
  return f;
}

export async function createOpencodeSession(
  input: { title?: string; parentID?: string } & OpencodeConfig = {},
): Promise<{ id: string }> {
  const res = await fetchOf(input)(`${resolveOpencodeBaseUrl(input)}/session`, {
    method: "POST",
    headers: buildOpencodeHeaders(input),
    body: JSON.stringify({ title: input.title, parentID: input.parentID }),
  });
  if (!res.ok) throw new Error(`opencode session create failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("opencode session create: missing id in response");
  return { id: json.id };
}

/** 동기 프롬프트: 응답이 완료될 때까지 대기하고 어시스턴트 텍스트를 반환. */
export async function opencodePrompt(
  input: {
    sessionID: string;
    model: OpencodeModel;
    prompt: string;
    system?: string;
    agent?: string;
  } & OpencodeConfig,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: input.model,
    parts: [{ type: "text", text: input.prompt }],
  };
  if (input.system) body.system = input.system;
  if (input.agent) body.agent = input.agent;

  const res = await fetchOf(input)(
    `${resolveOpencodeBaseUrl(input)}/session/${encodeURIComponent(input.sessionID)}/message`,
    { method: "POST", headers: buildOpencodeHeaders(input), body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`opencode prompt failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { parts?: OpencodePart[] };
  return extractAssistantText(json.parts ?? []);
}

/** 세션 생성 + 프롬프트를 한 번에. */
export async function opencodeComplete(
  input: { model: OpencodeModel; prompt: string; system?: string; title?: string } & OpencodeConfig,
): Promise<{ text: string; sessionID: string }> {
  const session = await createOpencodeSession(input);
  const text = await opencodePrompt({ ...input, sessionID: session.id });
  return { text, sessionID: session.id };
}

export async function opencodeHealth(cfg?: OpencodeConfig): Promise<boolean> {
  try {
    const res = await fetchOf(cfg)(`${resolveOpencodeBaseUrl(cfg)}/global/health`, {
      headers: buildOpencodeHeaders(cfg),
    });
    return res.ok;
  } catch {
    return false;
  }
}
