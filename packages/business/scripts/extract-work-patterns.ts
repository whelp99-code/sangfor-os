/**
 * 업무 트랜스크립트에서 "무슨 일을, 누구와, 어떻게 처리했는가"를 구조화 추출한다.
 *
 * 로컬 9router LLM(제로 비용)을 대화 단위로 호출한다. 페르소나 분석은 이 JSON을
 * 읽지, 1MB짜리 원문 전체를 읽지 않는다 — 원문은 표본 확인용으로만 쓴다.
 *
 * Usage: tsx packages/business/scripts/extract-work-patterns.ts [--limit N] [--concurrency N]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TRANSCRIPTS = path.join(REPO_ROOT, ".agents/results/learning/transcripts");
const OUT = path.join(REPO_ROOT, ".agents/results/learning/extractions.json");

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};
const LIMIT = arg("--limit", Infinity);
const CONCURRENCY = arg("--concurrency", 4);

function env(key: string): string {
  const line = fs
    .readFileSync(path.join(REPO_ROOT, ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return (line?.slice(key.length + 1) ?? "").replace(/^["']|["']$/g, "");
}

const BASE = env("OPENAI_BASE_URL");
const KEY = env("OPENAI_API_KEY");
const modelArg = process.argv.indexOf("--model");
// .env의 OPENAI_MODEL(Free-Tier)은 무응답으로 멈추는 일이 있어 기본값을 두지 않고
// 실패 시 다음 모델로 넘어간다. 응답 없이 매달리면 배치 전체가 조용히 죽는다.
const MODELS = modelArg > -1
  ? [process.argv[modelArg + 1]]
  : ["cx/gpt-5.4-mini", "ag/gemini-3.5-flash-low", "fusion"];
const TIMEOUT_MS = 60_000;

const SCHEMA = `{
  "workType": "견적요청 | 라이선스갱신 | 기술지원 | 발주계약 | 파트너등록 | 정보요청 | 정산청구 | 기타 (하나만)",
  "summary": "이 대화에서 처리한 업무 한 문장",
  "directCounterparty": {"name": "나와 직접 주고받은 회사", "domain": "메일 도메인", "role": "파트너 | 총판 | 벤더 | 고객 | 시스템"},
  "endCustomer": {"name": "실제 최종 사용 기업", "evidence": "그렇게 판단한 원문 문장 그대로"},
  "contacts": [{"name": "본문의 실명(이메일 아이디 금지)", "title": "직급", "company": "소속"}],
  "products": ["제품/모델명만. 회사명·프로젝트명 금지"],
  "amounts": ["원문에 나온 금액·수량"],
  "deadlines": ["기한·납기·만료일. 원문 표현 그대로"],
  "competitors": ["경쟁사·경쟁구도 언급"],
  "myActions": ["내가 실제로 취한 행동. 동사로"],
  "escalation": "내가 남에게 넘긴 일: '누구에게 무엇을'. 없으면 null",
  "outcome": "확인완료 | 응답완료 | 무응답 | 취소 | 불명",
  "outcomeEvidence": "outcome 판단 근거가 된 원문 문장 그대로. 없으면 null",
  "resolutionPattern": "재사용 가능한 처리 규칙 한 문장. 원문 근거가 없으면 null",
  "patternEvidence": "resolutionPattern의 근거 원문 문장 그대로. 없으면 null",
  "signals": ["다음에 같은 상황을 알아볼 단서: 발신 도메인, 제목 키워드 등"]
}`;

const SYSTEM =
  "당신은 한국 IT 인프라 유통사 '베를로'(blro.co.kr, 대표 박재민)의 업무 메일을 분석한다.\n" +
  "'나(blro)'는 박재민이다. JSON으로만 답하라. 설명·마크다운 금지. 모르면 null.\n\n" +
  "## 반드시 지킬 규칙 (어기면 학습이 오염된다)\n" +
  "1. 역할: 베를로는 유통사다. 나와 직접 메일하는 상대는 대개 파트너/SI/리셀러이지 최종고객이 아니다. " +
  "방향으로 판정하라 — 내가 견적·라이선스를 의뢰해 '받는' 쪽은 총판/벤더, 내가 제품을 '공급하는' 쪽은 고객, " +
  "자기 고객을 위해 나에게 요청하는 쪽은 파트너다.\n" +
  "2. endCustomer: 파트너 경유 건은 본문에 최종 사용 기업이 따로 나온다(예: 'DRB동일 고객사의', " +
  "'선진엔지니어링 HCI 견적서'). 반드시 찾아 넣고 근거 문장을 그대로 인용하라. 없으면 null.\n" +
  "3. outcome: '내가 답장을 보냈다'는 해결이 아니다.\n" +
  "   - 확인완료 = 상대가 수령·해결을 확인하는 회신을 보냈다. 그 문장을 outcomeEvidence에 인용하라.\n" +
  "   - 응답완료 = 내가 응답했으나 상대 확인이 없다. 대다수가 여기다.\n" +
  "   - 무응답 = 상대가 아예 답이 없다.\n" +
  "4. resolutionPattern: 원문에 근거가 없으면 지어내지 말고 null. 근거를 patternEvidence에 그대로 인용하라.\n" +
  "5. products: 제품·모델명만. 회사명·프로젝트명을 제품으로 넣지 마라.\n" +
  "6. contacts: 이메일 아이디가 아니라 본문의 실명을 넣어라.\n\n스키마:\n" +
  SCHEMA;

async function callModel(model: string, raw: string): Promise<string> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model,
      temperature: 0,
      // 9router는 기본이 SSE 스트리밍이라 명시하지 않으면 본문이 JSON이 아니다.
      stream: false,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: raw },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${model} ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

async function extract(file: string): Promise<Record<string, unknown> | null> {
  const raw = fs.readFileSync(path.join(TRANSCRIPTS, file), "utf8").slice(0, 12_000);

  let lastError = "";
  for (const model of MODELS) {
    try {
      const text = await callModel(model, raw);
      const json = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
      return { file, ...JSON.parse(json) };
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  throw new Error(lastError || "all models failed");
}

async function main() {
  const files = fs
    .readdirSync(TRANSCRIPTS)
    .filter((f) => f.endsWith(".md"))
    .slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

  console.log(`대화 ${files.length}건 추출 시작 (모델 ${MODELS.join(" → ")}, 동시 ${CONCURRENCY})`);
  const results: Record<string, unknown>[] = [];
  let failed = 0;
  let done = 0;

  const queue = [...files];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const file = queue.shift()!;
        try {
          const r = await extract(file);
          if (r) results.push(r);
          else failed++;
        } catch (e) {
          failed++;
          if (failed <= 3) console.error(`  ${file}: ${(e as Error).message}`);
        }
        if (++done % 25 === 0) console.log(`  ${done}/${files.length} …`);
      }
    }),
  );

  fs.writeFileSync(OUT, JSON.stringify(results, null, 2), "utf8");
  console.log(`\n추출 ${results.length} · 실패 ${failed} → ${OUT}`);

  const byType = new Map<string, number>();
  for (const r of results) {
    const t = String(r.workType ?? "불명");
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  console.log("\n업무 유형 분포:");
  for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) console.log(`  ${t}: ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
