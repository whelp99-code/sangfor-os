# Phase 4 Implementation Plan — God-File 분해: mail-candidates.ts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mail-candidates.ts (2,276줄, CCN 39)를 5개 모듈로 분해하여 각 모듈을 <15 CCN으로 정리. Phase 0 golden snapshot 무변화 보장.

**Architecture:** mail-candidates.ts를 도메인별로 분할:
- **constants.ts**: 상수 (KEYWORDS, INTERNAL_DOMAINS 등)
- **classify-rules.ts**: 순수 함수 기반 규칙 분류 (policy 연동, 도메인 검사)
- **classify-ai.ts**: AI 분류 로직 (OpenAI API 호출, 프롬프트 구성)
- **candidates-generate.ts**: mail candidate 생성 로직 (DB 저장)
- **candidates-update.ts**: mail candidate 업데이트/승인/거절 (DB 상태 관리)

**Tech Stack:** TypeScript, Zod, Prisma, vitest (golden snapshot), packages/business, packages/shared.

## Global Constraints

- **모듈 위치**: 모두 `packages/business/src/mail/` 디렉터리에 생성
- **Entry point 유지**: `packages/business/src/mail-candidates.ts` 기존 파일은 re-export만 담당 (호환성 유지)
- **검증 게이트**: 각 task 후 `pnpm typecheck` (로컬 충분)
- **스냅샷 보호**: Phase 0 `mail-candidates.golden.test.ts` 무변화 필수 (golden snapshot diff 발생 금지)
- **CCN 목표**: 각 모듈의 사이클로매틱 복잡도 < 15 (현재 mail-candidates.ts CCN=39)
- **각 커밋 유형**: `refactor:` (god-file 분해, 행위 무변화)
- **Phase 의존성**: Phase 3 merge 완료 필수
- **worktree 위험**: 동시 다중 agent 병렬 처리 권장 (각 task = 1 agent)

---

## mail-candidates.ts 현황 분석

| 섹션 | 줄 수 | 항목 | 설명 |
|---|---|---|---|
| **상수/설정** | ~33줄 | KEYWORDS, INTERNAL_DOMAINS, SYSTEM_SENDER_DOMAINS, INTERNAL_COMPANY_NAMES 등 | 도메인 정책, 키워드 기반 분류 |
| **순수 함수** | ~120줄 | normalizeCompanyName, isInternalCompanyName, domainMatches, extractCompanyFromDomain 등 | 문자열 처리, 도메인 검사, 헬퍼 |
| **AI 분류** | ~250줄 | buildChatCompletionRequestBody, 프롬프트 구성, OpenAI 호출 | AI 기반 분류 (검증/재분류) |
| **정책 연동** | ~180줄 | resolveThreadEntityPolicy, matchedPolicyMemories, buildMailIntelligenceMetadata | 정책 메모리 검색, 의사결정 | 
| **Candidate 생성** | ~320줄 | generateMailCandidates, generateMailCandidateDocuments | DB 저장, 배치 처리 |
| **분류 export** | ~400줄 | classifyMailCandidateDocument, classifyMailInsightThread, combineHybridClassification | 공개 분류 인터페이스 |
| **나머지** | ~373줄 | entity link, task creation, approval flow | DB 수정, entity 생성 |

**소계**: 2,276줄, 14 exported items, cyclomatic complexity 39

---

## Task 분할 전략 (병렬 세션)

```
Batch 1 (기초 module 2개, 독립적): 4-1, 4-2
  └─ 상수 & 순수 함수 추출 (re-export 없음)

Batch 2 (AI 로직 2개, 4-1/4-2 의존): 4-3, 4-4
  └─ AI 분류 + candidate 생성 (constants/rules 임포트)

Batch 3 (마무리 1개, 모두 의존): 4-5
  └─ re-export 통합, snapshot 검증

총 3개 opencode 세션 (Batch당 1 세션)
또는 순차 실행 (Batch 1 → Batch 2 → Batch 3)
```

---

## Task 4-1: 상수 & 설정 추출

**파일:**
- Create: `packages/business/src/mail/constants.ts` (신규)
- Create: `packages/business/src/mail/policy-helpers.ts` (신규, 정책 관련 헬퍼)
- Modify: `packages/business/src/mail-candidates.ts` (임포트 추가, 상수 제거)

**Interfaces:**
- Produces:
  - `export const KEYWORDS: Record<string, readonly string[]>`
  - `export const INTERNAL_DOMAINS: Set<string>`
  - `export const SYSTEM_SENDER_DOMAINS: Set<string>`
  - `export const INTERNAL_COMPANY_NAMES: Set<string>`
  - `export const KNOWN_PARTNER_NAMES: Set<string>`
  - `export const KNOWN_PARTNER_DOMAINS: Set<string>`
  - `export const STATIC_POLICY_LOOKUP: MailPolicyLookup`
  - Helper functions: `isInternalCompanyName(value?, policy?)`, `isKnownPartner(value?, policy?)`, `isKnownPartnerDomain(domain?, policy?)` 등

**Steps:**

- [ ] **Step 1: packages/business/src/mail/ 디렉터리 생성**

```bash
mkdir -p packages/business/src/mail
```

- [ ] **Step 2: packages/business/src/mail/constants.ts 신설**

```typescript
// packages/business/src/mail/constants.ts
import { buildStaticMailPolicyLookup } from "../mail-policy-memory";

export const KEYWORDS = {
  customer_inquiry: [
    "문의",
    "질문",
    "견적",
    "제안",
    "구매",
    "계약",
    "협력",
  ] as const,
  partner_collaboration: [
    "협력",
    "공동",
    "제휴",
    "파트너십",
    "연계",
  ] as const,
  internal_task: [
    "진행",
    "완료",
    "승인",
    "검토",
    "회의",
    "회의록",
  ] as const,
  project_milestone: [
    "프로젝트",
    "개발",
    "테스트",
    "배포",
    "런칭",
    "오픈",
  ] as const,
  opportunity: [
    "영업기회",
    "가능성",
    "타겟",
    "영업",
  ] as const,
} as const;

export const INTERNAL_DOMAINS = new Set([
  "sangfor.com",
  "sangfor.co.kr",
  "blro.co.kr",
  "ai-portal.local",
]);

export const SYSTEM_SENDER_DOMAINS = new Set(["bill36524.com"]);

export const INTERNAL_COMPANY_NAMES = new Set(["베를로", "blro"]);

export const KNOWN_PARTNER_NAMES = new Set(["넥시아스", "nexias"]);

export const KNOWN_PARTNER_DOMAINS = new Set(["nexias.co.kr"]);

export const STATIC_POLICY_LOOKUP = buildStaticMailPolicyLookup();
```

- [ ] **Step 3: packages/business/src/mail/policy-helpers.ts 신설**

```typescript
// packages/business/src/mail/policy-helpers.ts
import { MailPolicyLookup } from "../mail-policy-memory";
import {
  INTERNAL_COMPANY_NAMES,
  INTERNAL_DOMAINS,
  KNOWN_PARTNER_DOMAINS,
  KNOWN_PARTNER_NAMES,
  SYSTEM_SENDER_DOMAINS,
  STATIC_POLICY_LOOKUP,
} from "./constants";

export function isInternalCompanyName(
  value?: string,
  policy: MailPolicyLookup = STATIC_POLICY_LOOKUP
): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return (
    INTERNAL_COMPANY_NAMES.has(normalized) ||
    policy.domainsByRole["internal_company"]?.some((d) =>
      normalized.includes(d)
    ) ||
    false
  );
}

export function isKnownPartner(
  value?: string,
  policy: MailPolicyLookup = STATIC_POLICY_LOOKUP
): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return (
    KNOWN_PARTNER_NAMES.has(normalized) ||
    policy.domainsByRole["partner"]?.some((d) => normalized.includes(d)) ||
    false
  );
}

export function domainFromEmail(value?: string | null): string | undefined {
  if (!value) return undefined;
  const match = value.match(/@([a-z0-9.-]+)/i);
  return match ? match[1].toLowerCase() : undefined;
}

export function domainMatches(
  domain: string | undefined,
  domains: Set<string>
): boolean {
  return domain ? domains.has(domain.toLowerCase()) : false;
}

export function isInternalDomain(
  domain: string | undefined,
  policy: MailPolicyLookup = STATIC_POLICY_LOOKUP
): boolean {
  return (
    domainMatches(domain, INTERNAL_DOMAINS) ||
    policy.domainsByRole["internal_company"]?.some((d) => domain === d) ||
    false
  );
}

export function isSystemSenderDomain(
  domain: string | undefined,
  policy: MailPolicyLookup = STATIC_POLICY_LOOKUP
): boolean {
  return domainMatches(domain, SYSTEM_SENDER_DOMAINS);
}

export function isKnownPartnerDomain(
  domain: string | undefined,
  policy: MailPolicyLookup = STATIC_POLICY_LOOKUP
): boolean {
  return (
    domainMatches(domain, KNOWN_PARTNER_DOMAINS) ||
    policy.domainsByRole["partner"]?.some((d) => domain === d) ||
    false
  );
}
```

- [ ] **Step 4: packages/business/src/mail-candidates.ts 임포트 수정**

기존 상수 정의 제거, 임포트 추가:
```typescript
import {
  KEYWORDS,
  INTERNAL_DOMAINS,
  SYSTEM_SENDER_DOMAINS,
  INTERNAL_COMPANY_NAMES,
  KNOWN_PARTNER_NAMES,
  KNOWN_PARTNER_DOMAINS,
  STATIC_POLICY_LOOKUP,
} from "./mail/constants";
import {
  isInternalCompanyName,
  isKnownPartner,
  domainFromEmail,
  domainMatches,
  isInternalDomain,
  isSystemSenderDomain,
  isKnownPartnerDomain,
} from "./mail/policy-helpers";
```

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/mail/constants.ts packages/business/src/mail/policy-helpers.ts \
  packages/business/src/mail-candidates.ts

git commit -m "refactor: extract mail constants and policy helpers to mail/ module (P13)"
```

---

## Task 4-2: 순수 함수 & 규칙 분류

**파일:**
- Create: `packages/business/src/mail/classify-rules.ts` (신규)
- Modify: `packages/business/src/mail-candidates.ts` (임포트 추가, 함수 제거)

**Interfaces:**
- Consumes: constants.ts, policy-helpers.ts
- Produces:
  - `export function normalizeCompanyName(value: string): string`
  - `export function extractCompanyFromDomain(domain: string): string`
  - `export function extractContactFromEmail(email: string, name?: string): string`
  - `export function matchKeywords(text: string, keywords: readonly string[]): string[]`
  - `export function compactSummary(body: string): string`
  - `export function matchedPolicyMemories(policy: PolicyDecision): Array<{...}>`
  - Helper validators: `isProjectCandidateType()`, `asRecord()`, `asStringArray()` 등

**Steps:**

- [ ] **Step 1: packages/business/src/mail/classify-rules.ts 신설**

```typescript
// packages/business/src/mail/classify-rules.ts
import { KEYWORDS } from "./constants";

export function normalizeCompanyName(value: string): string {
  return value.toLowerCase().trim().replace(/[^\w가-힣]/g, "");
}

export function extractCompanyFromDomain(domain: string): string {
  const [name] = domain.split(".");
  return name.replace(/[-_]/g, "");
}

export function extractContactFromEmail(
  email: string,
  name?: string
): string {
  const [local] = email.split("@");
  return name ? `${name} <${email}>` : email;
}

export function matchKeywords(
  text: string,
  keywords: readonly string[]
): string[] {
  const normalized = text.toLowerCase();
  return keywords.filter((kw) => normalized.includes(kw.toLowerCase()));
}

export function compactSummary(body: string): string {
  const lines = body.split("\n").slice(0, 5);
  return lines.join(" ").substring(0, 200);
}

export function isProjectCandidateType(candidateType: string): boolean {
  return ["task", "poc", "opportunity"].includes(candidateType);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v) => typeof v === "string")
    : [];
}

export function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asObjectArray(
  value: unknown
): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v) => typeof v === "object" && v !== null)
    : [];
}

export function uniquePolicyDomains(
  values: Array<string | undefined>
): string[] {
  return Array.from(new Set(values.filter((v) => v && v.length > 0)));
}
```

- [ ] **Step 2: packages/business/src/mail-candidates.ts에서 해당 함수 제거, 임포트 추가**

```typescript
import {
  normalizeCompanyName,
  extractCompanyFromDomain,
  extractContactFromEmail,
  matchKeywords,
  compactSummary,
  isProjectCandidateType,
  asRecord,
  asStringArray,
  asUnknownArray,
  asObjectArray,
  uniquePolicyDomains,
} from "./mail/classify-rules";
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/business/src/mail/classify-rules.ts packages/business/src/mail-candidates.ts

git commit -m "refactor: extract pure classification rules to mail/classify-rules (P13)"
```

---

## Task 4-3: AI 분류 로직 추출

**파일:**
- Create: `packages/business/src/mail/classify-ai.ts` (신규)
- Modify: `packages/business/src/mail-candidates.ts` (AI 함수 제거)

**Interfaces:**
- Consumes: openai-config, mail-policy-memory, constants, classify-rules
- Produces:
  - `export function buildChatCompletionRequestBody(prompt: string, documents: unknown[]): object`
  - `export async function classifyMailWithAi(documents: unknown[], projectId: string): Promise<AiClassificationResult>`
  - `export function extractChatCompletionText(response: unknown): string`

**Steps:**

- [ ] **Step 1: packages/business/src/mail/classify-ai.ts 신설**

기존 mail-candidates.ts의 AI 관련 함수들 (buildChatCompletionRequestBody, classifyMailWithAi, extractChatCompletionText 등)을 이동.

```typescript
// packages/business/src/mail/classify-ai.ts
import {
  buildChatCompletionRequestBody,
  extractChatCompletionText,
  getOpenAiApiKey,
  getOpenAiAuthHeaders,
  getOpenAiChatCompletionsUrl,
  getOpenAiModel,
} from "../openai-config";
import { loadLlmConfigFromDb } from "../llm-settings";

export async function classifyMailWithAi(
  documents: unknown[],
  projectId: string
): Promise<unknown> {
  const llmConfig = await loadLlmConfigFromDb();
  const model = getOpenAiModel(llmConfig);
  const url = getOpenAiChatCompletionsUrl();
  const headers = getOpenAiAuthHeaders();
  const body = buildChatCompletionRequestBody(
    "Classify mail documents...",
    documents
  );

  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await response.json();
  const text = extractChatCompletionText(data);
  return JSON.parse(text);
}
```

- [ ] **Step 2: packages/business/src/mail-candidates.ts에서 AI 함수 제거, 임포트 추가**

```typescript
import {
  classifyMailWithAi,
  extractChatCompletionText,
} from "./mail/classify-ai";
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/business/src/mail/classify-ai.ts packages/business/src/mail-candidates.ts

git commit -m "refactor: extract AI classification logic to mail/classify-ai (P13)"
```

---

## Task 4-4: Candidate 생성 로직 추출

**파일:**
- Create: `packages/business/src/mail/candidates-generate.ts` (신규)
- Modify: `packages/business/src/mail-candidates.ts` (candidate 생성 함수 제거)

**Interfaces:**
- Consumes: prisma, classify-ai, classify-rules, constants, policy-helpers
- Produces:
  - `export async function generateMailCandidates(input: GenerateInput): Promise<MailCandidate[]>`
  - `export async function generateMailCandidateDocuments(threads: ThreadLike[], projectId: string): Promise<GenerateResult>`

**Steps:**

- [ ] **Step 1: packages/business/src/mail/candidates-generate.ts 신설**

기존 generateMailCandidates, generateMailCandidateDocuments 함수 이동.

```typescript
// packages/business/src/mail/candidates-generate.ts
import { Prisma, prisma } from "@sangfor/db";
import { sanitizeJsonStrings } from "@sangfor/shared";

export async function generateMailCandidates(
  input: unknown
): Promise<unknown[]> {
  // 기존 generateMailCandidates 로직
  const { projectSlug = "demo-project", limit = 50 } = input || {};
  
  const candidates = await prisma.mailCandidate.findMany({
    where: { project: { slug: projectSlug } },
    take: limit,
  });
  
  return candidates;
}

export async function generateMailCandidateDocuments(
  threads: unknown[],
  projectId: string
): Promise<unknown> {
  // 기존 generateMailCandidateDocuments 로직
  const documents = threads.map((thread) => ({
    messageId: (thread as any).messageId,
    subject: (thread as any).subject,
    body: (thread as any).body,
  }));
  
  const sanitized = sanitizeJsonStrings(documents);
  
  return {
    count: documents.length,
    documents: sanitized,
  };
}
```

- [ ] **Step 2: packages/business/src/mail-candidates.ts에서 candidate 생성 함수 제거, 임포트 추가**

```typescript
import {
  generateMailCandidates,
  generateMailCandidateDocuments,
} from "./mail/candidates-generate";
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/business/src/mail/candidates-generate.ts packages/business/src/mail-candidates.ts

git commit -m "refactor: extract mail candidate generation to mail/candidates-generate (P13)"
```

---

## Task 4-5: Re-export 통합 및 최종 검증

**파일:**
- Modify: `packages/business/src/mail-candidates.ts` (모든 모듈 re-export)
- Verify: Phase 0 golden snapshot 무변화

**Steps:**

- [ ] **Step 1: packages/business/src/mail-candidates.ts 정리 (re-export만 남기기)**

```typescript
// packages/business/src/mail-candidates.ts (최종 형태)
// 모든 public API는 여기서 re-export

export * from "./mail/constants";
export * from "./mail/policy-helpers";
export * from "./mail/classify-rules";
export * from "./mail/classify-ai";
export * from "./mail/candidates-generate";

// 기존 public export는 유지
export {
  classifyMailCandidateDocument,
  classifyMailInsightThread,
  combineHybridClassification,
  // ... 다른 공개 함수들
} from "./mail-candidates-impl";
```

- [ ] **Step 2: 기존 로직은 packages/business/src/mail-candidates-impl.ts로 이동 (또는 적절한 모듈)**

mail-candidates.ts의 남은 export 함수들(classifyMailCandidateDocument 등)을 전용 모듈로 이동.

- [ ] **Step 3: Phase 0 스냅샷 검증**

```bash
pnpm test -- mail-candidates.golden.test.ts
```

Expected: 모든 golden snapshot match (분류 결과 동일)

- [ ] **Step 4: 전역 typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors

- [ ] **Step 5: 전역 테스트 실행**

```bash
pnpm test
```

Expected: 모든 테스트 통과 (신규 모듈 테스트 포함)

- [ ] **Step 6: 모듈 복잡도 검증**

각 신규 모듈의 cyclomatic complexity 확인:
```bash
# 각 파일마다 대략적으로 CCN < 15 확인 (eslint-plugin-complexity 또는 수동 확인)
```

- [ ] **Step 7: Commit**

```bash
git add packages/business/src/mail-candidates.ts packages/business/src/mail-candidates-impl.ts \
  packages/business/src/mail/*.ts

git commit -m "refactor: consolidate mail module re-exports, verify snapshot (P13)"
```

---

## Phase 4 최종 게이트 (완료 후 실행)

- [ ] **모든 5개 task의 commit 생성 확인**

```bash
git log --oneline -5 refactor/phase-4-god-file-decomposition
```

Expected: 5개 commit (4-1 ~ 4-5)

- [ ] **전역 타입 검사**

```bash
pnpm typecheck
```

Expected: 0 errors

- [ ] **메일 분류 스냅샷 무변화** (Phase 0 보호)

```bash
pnpm test -- mail-candidates.golden.test.ts
```

Expected: all snapshots match (분류 결과 동일)

- [ ] **CCN 감소 확인**

mail-candidates.ts 복잡도: 39 → (각 모듈 평균 <15)

---

## Phase 4 종료 후: understand-anything 학습

**⚠️ CRITICAL GATE: Phase 4 완료 후 아래 step을 반드시 실행**

- [ ] **understand-anything 재학습 (deepseek v4-flash 모델)**

Phase 4의 대규모 구조 변화를 knowledge graph에 반영:

```bash
# understand-anything 스킬 실행
/understand --full --language ko -m deepseek/deepseek-v4-flash
```

**Expected output:**
- `.understand-anything/knowledge-graph.json` 생성 (updated)
- `.understand-anything/meta.json` 갱신 (commit hash, timestamp)
- 분석 결과: 5개 신규 모듈 노드 추가, mail-candidates 분해 edge 업데이트

**Timeline:** 이 step은 Phase 5 착수 전에 반드시 완료. Phase 5 의사결정(persona/mail-intelligence 흡수)이 이 그래프에 의존함.

**명령어 정확도:**
```bash
cd /Users/jmpark/orca/workspaces/sangfor-os/main-fork
/understand --full --language ko -m deepseek/deepseek-v4-flash
# 또는 (만약 understand-anything이 CLI로 직접 호출 불가한 경우)
pnpm --filter @understand-anything/cli run understand --full --language ko -m deepseek/deepseek-v4-flash
```

---

## 의사결정 필요 (Phase 4 시작 전)

| 항목 | 결정 | 기한 |
|---|---|---|
| **병렬 vs 순차** | Batch 1-2-3 동시 vs 순차 실행 | 즉시 (순차 권장, 의존성 고려) |
| **mail-candidates-impl.ts** | 남은 public export들의 모듈 위치 (candidates-update? classify-impl?) | Task 4-4 완료 시 |

---

## 참고

- **기존 Phase 2 산출물**: mail-domain-registry.ts (constants 일부 중복 제거 가능)
- **Phase 3 완료 후 의존성**: Phase 3 (route 레이어링)이 이 모듈들을 참조 가능
- **Snapshot 보호**: mail-candidates.golden.test.ts는 Phase 0 분류 결과가 정확히 동일해야 함 (분해 후에도 동작 무변화)
- **최종 PR**: Phase 4 완료 후 PR #N "refactor: Phase 4 — god-file decomposition" merge

---

## Phase 5 미리보기 (Reference Only)

Phase 4 완료 후 understand-anything 재학습 시 Phase 5 계획 결정:

- **Phase 5-A**: business 패키지 재편 (mail/ domain-ai/ crm/ 등으로 구조 전환)
- **Phase 5-B**: persona/mail-intelligence 흡수 여부 (단일화? 별도?)

Phase 4 know-ledge graph가 Phase 5 의사결정의 근거 자료 역할.
