# 개발계획서 — 베를로 OS v1 완성 (01)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans로 태스크 단위 실행. 스텝은 체크박스(`- [ ]`)로 추적한다. 착수 전 반드시 `docs/master-plan/00-INDEX.md`의 공통 프로토콜(§3)을 읽는다.

**Goal:** 베를로 OS를 "v1 완성" 상태 — ①도메인 AI 제안→검증→사람 결정→학습→문서 승격 루프가 닫히고, ②모든 화면의 숫자가 서로 일치하며, ③데이터 3개 섬(CRM/메일/재무)이 연결되고, ④메뉴·화면에 가짜/준비중이 없는 상태 — 로 만든다.

**Architecture:** 기존 구조 유지(Next.js web :3101 + apps/api 재무 :3200 + packages/business 도메인 로직 + 단일 Prisma 스키마). 이 계획은 신규 아키텍처가 아니라 **미커밋 기능 출하 + 정합성 수복 + 연결 완성**이다.

**Tech Stack:** Next.js(App Router)·TypeScript·Prisma(Postgres :5434)·vitest·Playwright·로컬 9router LLM(:20128).

## Global Constraints (00-INDEX §3 요약 — 전 태스크 공통)
- 게이트: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 전부 통과 후에만 완료 선언. DB 의존 테스트는 `CI_INTEGRATION=1` + `pnpm docker:dev`.
- DB: 정식 마이그레이션만. additive/nullable only. `db push --accept-data-loss` 금지.
- 브랜치: `git checkout -b <branch> origin/main` (main 직접 체크아웃 금지), 조기 커밋.
- 커밋 금지: `.env*`, `next-env.d.ts` 자동 diff.
- LLM 라이브 검증 전 `curl -s http://127.0.0.1:20128/health` 로 9router 확인.

## 실행 순서와 병렬성

```
WP-A (컬러게이트 루프 출하)          ← 최우선. 미커밋 작업이 날아가기 전에.
  └→ WP-B (지표 정합 P0)            ← A와 독립이지만 같은 트리를 만지므로 A 머지 후.
       └→ WP-C (프로젝트 현실화 + 섬 연결 P1/P2)   ← B의 헬퍼를 사용.
            ├→ WP-D (화면 마감)      ← C와 병렬 가능 (파일 겹침 없음)
            └→ WP-E (IA 정리 P3)     ← C 완료 후 (메뉴가 실데이터 기준으로 정리되어야 함)
```
각 WP는 독립 PR 1개. WP 내부 태스크는 순서대로.

---

## WP-A: 컬러게이트 루프 완결·출하 (미커밋 작업)

**배경**: 워킹트리에 "제안서 LLM 5-렌즈 검증 + 사람 승인 시 GeneratedDocument 승격" 기능이 미커밋 상태로 있다.
스키마(`DomainDecisionLog.colorGateJson/resolvedAt/resolvedBy`, `GeneratedDocument`/`DocumentVersion`)·API(`/api/projects/[id]/domain-decision`, `/generate`)·UI(프로젝트 허브 렌즈 칩) 배선은 정합함이 확인됐다. 남은 것: 통합 테스트, 마이그레이션 확인, UI에서 승격 문서 링크 소비, 커밋/PR.

**브랜치**: `feat/color-gate-llm-loop`

### Task A-1: 마이그레이션 존재 확인 (없으면 생성)

**Files:** 확인: `packages/db/prisma/migrations/**`, `packages/db/prisma/schema.prisma`

- [x] **Step 1: 컬럼이 마이그레이션에 포함되어 있는지 확인** ✅ 2026-07-07: `@map`된 snake_case로 존재 — `color_gate_json`(20260629110000_domain_axis_memory_decision_logs), `resolved_at`/`resolved_by`(20260701200000_ai_decision_substrate)
```bash
grep -rn "colorGateJson\|resolvedAt\|resolvedBy" packages/db/prisma/migrations/ | head
```
Expected: PR #94에서 생성된 마이그레이션에 3컬럼의 `ALTER TABLE "domain_decision_logs" ADD COLUMN ...`이 존재.
- [x] **Step 2-A (존재하면)**: 로컬 DB에 적용 여부 확인 후 종료. ✅ 2026-07-07 `prisma migrate status` → "Database schema is up to date!"
```bash
pnpm --filter @sangfor/db db:migrate:deploy   # "No pending migrations" 또는 적용 로그
```
- [ ] **Step 2-B (없으면)**: schema에는 있고 마이그레이션이 없는 상태 = drift. 정식 마이그레이션 생성:
```bash
cd packages/db
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > /tmp/color-gate.sql
# /tmp/color-gate.sql 내용을 눈으로 검토: ADD COLUMN 3건만 있어야 함 (DROP류가 보이면 중단하고 보고)
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_domain_decision_color_gate
cp /tmp/color-gate.sql prisma/migrations/<위 디렉터리>/migration.sql
npx prisma migrate resolve --applied <위 디렉터리명>   # 이미 push로 적용된 DB라면 resolve, 아니면 deploy
```
- [x] **Step 3: 검증** — `pnpm --filter @sangfor/db db:migrate:deploy`가 empty-diff/clean으로 끝나는지 확인. ✅ 2026-07-07 migrate status clean (Step 2-B는 drift 없어 N/A)

**Acceptance:** fresh DB에서 `migrate deploy`만으로 `colorGateJson` 컬럼이 생긴다. `prisma migrate status`에 drift 없음.

### Task A-2: `proposal-promote` 통합 테스트

**Files:**
- Create: `packages/business/src/domain-ai/proposal-promote.test.ts`
- 참고(팩토리 재사용): `packages/business/src/engagement-conversion.test.ts` — project/customer/opportunity/engagement 생성에 필요한 필수 필드는 이 파일의 팩토리를 그대로 복사한다(추측으로 필드를 새로 쓰지 말 것).

**Interfaces (테스트 대상):**
- `promoteDomainProposalToDocument(input: {engagementId, domain, title, bodyMarkdown, status?}) => Promise<{documentId} | null>`
- 체인 없으면 null(비파괴), 있으면 `DocumentTemplate`(projectId+templateKey `domain-ai` upsert) → `GeneratedDocument`(status 기본 `approved`) → `DocumentVersion`(version 1).

- [x] **Step 1: 실패하는 테스트 작성** — `CI_INTEGRATION=1` 게이트, 공유 DB이므로 생성 데이터는 전부 `test-promote-` prefix + afterAll 정리. ✅ 2026-07-07 `proposal-promote.test.ts` (커밋 e8c21a9, IT_PROMOTE_ 태그 정리 포함)
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@sangfor/db";
import { promoteDomainProposalToDocument } from "./proposal-promote";

const integration = process.env.CI_INTEGRATION === "1" ? describe : describe.skip;

integration("promoteDomainProposalToDocument", () => {
  let engagementId: string;
  // beforeAll: engagement-conversion.test.ts의 팩토리를 복사해
  // project → customer → opportunity(projectId 연결) → engagement(opportunityId 연결) 체인 생성.
  // afterAll: documentVersion → generatedDocument → documentTemplate → engagement → opportunity
  //           → customer → project 역순 deleteMany (where: test-promote- prefix / 생성 id).

  it("승인 시 GeneratedDocument + DocumentVersion(v1)을 만든다", async () => {
    const r = await promoteDomainProposalToDocument({
      engagementId, domain: "presales",
      title: "test-promote-제안", bodyMarkdown: "# 본문",
    });
    expect(r).not.toBeNull();
    const doc = await prisma.generatedDocument.findUnique({ where: { id: r!.documentId } });
    expect(doc?.status).toBe("approved");
    expect(doc?.engagementId).toBe(engagementId);
    const v = await prisma.documentVersion.findFirst({ where: { generatedDocumentId: r!.documentId } });
    expect(v?.version).toBe(1);
  });

  it("같은 프로젝트 2회 승격 시 템플릿은 1개만 upsert된다", async () => {
    await promoteDomainProposalToDocument({ engagementId, domain: "presales", title: "test-promote-2", bodyMarkdown: "b" });
    const templates = await prisma.documentTemplate.findMany({ where: { templateKey: "domain-ai" } });
    // 이 프로젝트 범위에서 1개 (다른 테스트 프로젝트 오염 방지 위해 projectId로 필터)
  });

  it("체인이 없으면(가짜 engagementId) null 반환, 아무것도 만들지 않는다", async () => {
    const before = await prisma.generatedDocument.count();
    const r = await promoteDomainProposalToDocument({
      engagementId: "nonexistent-id", domain: "sales", title: "x", bodyMarkdown: "y",
    });
    expect(r).toBeNull();
    expect(await prisma.generatedDocument.count()).toBe(before);
  });
});
```
- [x] **Step 2: 실패 확인** — `CI_INTEGRATION=1 pnpm --filter @sangfor/business exec vitest run src/domain-ai/proposal-promote.test.ts` → 팩토리 미완성 상태에선 FAIL이 정상. ✅ 2026-07-07 완료 (커밋 e8c21a9)
- [x] **Step 3: 팩토리 완성 → 통과 확인** — 같은 명령, Expected: 3 passed. ✅ 2026-07-07 통합 3케이스 통과 (DEV_REFERENCE 변경이력 2026-07-07 참조)
- [x] **Step 4: 전체 게이트** — `pnpm --filter @sangfor/business test` (기존 68개 파일 무손상). ✅ 2026-07-07 도메인-AI 98테스트 무회귀 확인

**Acceptance:** 통합 3케이스 통과 + 비통합 환경(`CI_INTEGRATION` 미설정)에서 skip 처리.

### Task A-3: 승격 문서 링크 UI 소비

**Files:**
- Modify: `apps/web/src/app/(portal)/projects/[id]/page.tsx` 및 해당 클라이언트 컴포넌트(레인 결정 컨트롤 — `LaneDecisionControls` 또는 이 페이지가 임포트하는 결정 버튼 컴포넌트. `grep -rn "domain-decision" apps/web/src`로 위치 특정).

**Interfaces:** `POST /api/projects/[id]/domain-decision` 응답에 이미 `documentId?: string`이 포함된다(승격 성공 시).

- [x] **Step 1**: 승인 성공 응답에서 `documentId`가 있으면 결정 카드 하단에 `<Link href={`/proposals/${documentId}`}>산출물 문서 보기 →</Link>` 렌더 (계기판 톤: brass 텍스트 링크, 새 배지 금지 — DESIGN.md "계기는 정직"). ✅ 2026-07-07 `LaneDecisionControls` brass 링크 (커밋 c896e40)
- [x] **Step 2**: `/proposals/[id]` 상세가 GeneratedDocument id를 렌더하는지 확인(`apps/web/src/app/(portal)/proposals/[id]/page.tsx`). 아니면 링크 target을 실제 상세 라우트에 맞춘다. ✅ 2026-07-07 확인 (documentId 있을 때만 링크)
- [x] **Step 3**: 수동 검증 — `scripts/dev-up.sh` → 프로젝트 허브에서 pending 제안 승인 → 링크 클릭 → 문서 v1 본문 확인. 스크린샷 저장(playwright-verify 스킬). ✅ 2026-07-07 PASS — 승인→brass 링크(`#7C5E1E`)→`/proposals/[id]` 문서 v1(2,042자) 렌더, 콘솔 에러 0건, `generated_documents` approved 신규 row 생성 확인. 증거: `.agents/results/2026-07-07-wp-a3-live.md` + 스크린샷 5장(`.agents/results/wp-a3-screens/`)

**Acceptance:** 승인 → 문서 링크 노출 → 클릭 시 승격된 문서가 열린다. 체인이 없어 승격이 스킵된 경우 링크가 안 뜨고 에러도 없다.
✅ 2026-07-07 충족 (위 Step 3 증거). PR #96.

### Task A-4: 커밋 분할 + PR 출하

- [x] **Step 1**: 커밋 3개로 분할:
```bash
git checkout -b feat/color-gate-llm-loop
git add packages/business/src/domain-ai/color-gate-llm.ts packages/business/src/domain-ai/color-gate-llm.test.ts packages/business/src/domain-ai/index.ts
git commit -m "feat(domain-ai): LLM 5-lens color gate verdict for domain proposals"
git add packages/business/src/domain-ai/proposal-promote.ts packages/business/src/domain-ai/proposal-promote.test.ts packages/business/src/project-decision.ts packages/business/src/domain-ai/domain-proposal.ts packages/business/src/artifact-domain-map.ts
git commit -m "feat(domain-ai): promote approved proposals to GeneratedDocument + close decision queue"
git add "apps/web/src/app/(portal)/projects/[id]/page.tsx"
git commit -m "feat(web): color gate lens chips + promoted document link on project hub"
```
✅ 2026-07-07 **정정**: 계획한 3커밋 분할 대신 실제로는 7커밋(캘리브레이션 fix → A-2 테스트 → A-3 UI → dev-reference 문서 → dev-up.sh 스크립트픽스 → 마스터플랜 체크 → 게이트 증거)으로 출하됨. 내용상 동등(도메인-AI 로직/테스트/UI 3계층 분리 유지), 커밋 개수만 계획과 다름.
- [x] **Step 2**: `.env.bak.9router`는 커밋하지 않는다(로컬 백업). `next-env.d.ts` diff는 `git checkout -- apps/web/next-env.d.ts`로 버린다. ✅ 확인, 커밋 없음
- [x] **Step 3**: 게이트 4종 + 통합 테스트 실행, 출력 확인. ✅ 2026-07-07 6/6 green (lint 0 errors/typecheck/test 134 passed/build/`CI_INTEGRATION=1` 66 files·502 passed). 증거: `.agents/results/2026-07-07-wp-a-gates.md`
- [x] **Step 4**: `scripts/round-ship.sh feat/color-gate-llm-loop "feat(domain-ai): color-gate LLM verdict + proposal promotion loop" "<본문: 위 3커밋 요약 + 검증 증거>"` ✅ PR #96 출하(제목: "fix(color-gate): honest-placeholder calibration + WP-A loop completion")
- [x] **Step 5**: `gh pr checks --watch` → 머지 확인 → `.agents/results/2026-07-XX-wp-a-ship.md`에 증거 기록. ✅ 2026-07-07 머지 (squash `a73ae10`). **정정**: 계획한 파일명 `wp-a-ship.md`는 별도로 만들지 않고, 동일 목적의 증거를 `wp-a-gates.md`(게이트) + `wp-a3-live.md`(라이브 검증)에 기록.

**Acceptance:** PR 머지, main에서 게이트 4종 green, 라이브에서 제안 생성 시 `colorGateJson` 비-null.
✅ 2026-07-07 충족. PR #96 머지, 게이트 6/6 green, 라이브 승인 플로우에서 `colorGateJson` 비-null 확인(A-3 재검증).

---

## WP-B: 지표 정합 (감사 P0)

**배경**: "진행중 딜"이 화면마다 26/26/37/20으로 다르다. 원인: active 스테이지 판정이 5곳에 제각각 인라인 + raw-string 정규화 버그 + executive 대시보드 소문자 키 버그 + 홈 깔때기 enum 미매핑. 정확한 file:line 목록은 `.agents/results/system-integrity-audit-2026-07-03.md` §지표 절에 있다 — **착수 시 반드시 그 문서를 열어 위치를 확정**한다.

**브랜치**: `fix/metric-consistency`

### Task B-1: 단일 스테이지 헬퍼 신설

**Files:**
- Modify: `packages/business/src/crm/opportunity-stage.ts` (이미 존재 — 여기에 추가, 새 파일 만들지 말 것)
- Test: `packages/business/src/crm/opportunity-stage.test.ts` (기존 테스트 파일에 케이스 추가)

**Interfaces (Produces):**
```ts
export const ACTIVE_OPPORTUNITY_STAGES: readonly string[];  // 진행중으로 치는 스테이지의 canonical 집합
export function isActiveOpportunity(stage: string | null | undefined): boolean; // 정규화(trim/lower/enum-map) 포함
export function normalizeOpportunityStage(raw: string | null | undefined): string | null; // raw string → canonical enum 값
```
- [x] **Step 1**: 실패 테스트 — DB에 실재하는 raw 변형(감사 문서에 나온 표기 흔들림 예시)을 케이스로: 대소문자·공백·한/영 변형이 전부 같은 canonical로 정규화되는지, WON/LOST/CLOSED류가 active=false인지. ✅ 2026-07-07 (`opportunity-stage.test.ts`, PR #97)
- [x] **Step 2**: 구현. canonical 집합은 Prisma `OpportunityStage` enum과 감사 문서의 실데이터 분포(`SELECT stage, count(*) FROM opportunities GROUP BY stage`)를 대조해 결정. 애매하면 "PROPOSAL/POC/NEGOTIATION/QUALIFIED류 = active, WON/LOST/보류 = inactive"를 기본으로 하고 판단 근거를 테스트 주석에 남긴다. ✅ `ACTIVE_OPPORTUNITY_STAGES`/`isActiveOpportunity`/`normalizeOpportunityStage` + 신규 `isRecognizedStage`(미매핑 스테이지를 "기타"로 정직 표기하기 위한 헬퍼, LEAD 포함 판단 근거는 테스트 주석)
- [x] **Step 3**: 테스트 통과 → 커밋 `feat(crm): canonical active-stage helper (single source for deal metrics)`. ✅ vitest 47/47 통과 (독립 재검증: `.agents/results/2026-07-07-wp-b-consistency.md`)

### Task B-2: 5개 소비처 치환

**Files (감사 문서에서 file:line 확정):**
- Modify: 홈 깔때기(`apps/web/src/app/(portal)/home/page.tsx`), 경영 대시보드 데이터 소스(`packages/business/src/role-dashboard.ts` 또는 `apps/web/src/app/api/dashboard/[role]/route.ts`), 딜 목록(`(portal)/deals/page.tsx`), 기회 목록(`(portal)/opportunities/page.tsx`), 일일 리포트(`api/daily-report/route.ts`).

- [x] **Step 1**: 각 소비처의 인라인 스테이지 필터를 `isActiveOpportunity`/`ACTIVE_OPPORTUNITY_STAGES`로 치환. Prisma where절에는 `stage: { in: [...ACTIVE_OPPORTUNITY_STAGES] }` 형태로. ✅ 홈 깔때기·경영 대시보드(`revenuePipeline`)·딜 보드(칸반, 로컬 `ACTIVE_STAGES` 제거)·기회 목록·일일 리포트(Prisma `stage IN`) 5곳 전부 치환
- [x] **Step 2**: 홈 깔때기 죽은 칸(③⑤⑥ 항상 0) — 미매핑 enum을 `normalizeOpportunityStage` 기반 매핑표로 연결. 매핑 불가 스테이지는 "기타" 칸으로 정직 표기(0 고정 칸 금지). ✅ ③⑤⑥ 제거 → 4버킷 + `isRecognizedStage` 기반 정직한 "기타" catch-all
- [x] **Step 3**: executive 대시보드 소문자 키 버그 — 감사 문서 지목 위치에서 키 정규화 수정. ✅ `revenuePipeline` 가중치 키 정규화 수정 + active-only 집계
- [x] **Step 4: 정합 검증(핵심)** — dev 스택 기동 후 4화면(홈/대시보드/딜/기회)과 daily-report API의 "진행중 딜" 수가 **모두 동일**한지 확인하고 숫자를 증거로 기록:
```bash
scripts/dev-up.sh
# 각 화면 스크린샷 + curl로 API 수치 채집 → .agents/results/2026-07-XX-wp-b-consistency.md
```
✅ 2026-07-07 독립 재검증 PASS — 홈/executive API/딜 칸반/기회 목록/daily-report **5표면 전부 = 56** (DB 기준값: LEAD 30+QUALIFIED 4+PROPOSAL 16+POC 0+NEGOTIATION 6). 증거: `.agents/results/2026-07-07-wp-b-consistency.md` + 스크린샷 4장(`wp-b-screens/`). **관찰(미수정)**: `/deals`·`/opportunities` 임베드 헤더의 정적 라벨 "전체 진행중·67건"(WON/LOST 포함 전체-필터 행수, active 지표 아님)이 옆의 "진행 중 56건"과 나란히 보여 모순으로 읽힐 수 있음 → 파일소유 충돌 회피를 위해 WP-D 브랜치로 이월, PR #98에서 실제 수정됨(활성 필터 칩과 라벨 동기화).
- [x] **Step 5**: 커밋 `fix(metrics): unify active-deal counting across 5 surfaces` → PR 출하. ✅ PR #97 머지 (squash `ccf5482`)

**Acceptance:** 동일 시점 조회에서 5개 표면의 진행중 딜 수가 완전히 일치. golden/특성화 테스트(Phase 0) 통과 유지.
✅ 2026-07-07 충족 (위 Step 4 증거). PR #97.

---

## WP-C: 프로젝트 모델 현실화 + 데이터 섬 연결 (감사 P1/P2)

**브랜치**: `feat/data-island-bridge`
**선행**: WP-B 머지 (스테이지 헬퍼 사용).

### Task C-1: 프로젝트 선택기 현실화 (MOCK_PROJECTS 제거)

**Files:** `grep -rn "MOCK_PROJECTS" apps/web/src` 로 특정 (감사 기준: 프로젝트 선택기 컴포넌트).

- [x] **Step 1**: 결정 반영 — 감사 권고대로 **단일 프로젝트 확정** 모델: DB `Project` 테이블의 실제 행을 조회해 렌더하고, 하드코딩 배열 삭제. 프로젝트가 1개면 선택기는 고정 라벨로 렌더(가짜 선택지 금지). ✅ 2026-07-07 `MOCK_PROJECTS` 제거, 실데이터 셀렉터(`project-selector.tsx`) + `GET /api/projects/default` (PR #100)
- [x] **Step 2**: 선택된 projectId가 대시보드/일일리포트 조회 where절에 실제로 전달되는지 배선(감사: project 필터 부재). `dashboard/[role]` route와 `daily-report` route에 `projectId` 쿼리 파라미터 추가 → business 함수까지 관통. ✅ `useDefaultProject` 훅 + 리졸버 폴백으로 관통
- [x] **Step 3**: 테스트 — role-dashboard 계산 함수에 projectId 스코프 케이스 추가. ✅

### Task C-2: `"demo-project"` 하드코딩 정리 (P18, 18곳)

> ✅ 2026-07-07 **정정**: 착수 시 재조사 결과 계획 추정치("18곳")와 실제 규모가 달랐다 — 웹 런타임 전체 기준 약 93곳 중 **프론트(apps/web) 17곳**은 이번 라운드에 전량 치환, **중앙해석점(리졸버)** 신설로 처리. 나머지 **B그룹 76곳(주로 packages/business의 개별 create* 헬퍼·mail-candidates 경로)은 부분 마이그레이션 상태로 06 문서(4차 고도화)로 이월** — `docs/master-plan/backlog.md` 참고.

- [x] **Step 1**: `grep -rn '"demo-project"' --include='*.ts' --include='*.tsx' apps packages | tee /tmp/demo-refs.txt` — 18곳 전수 목록화. ✅ 재조사로 93곳 확정(위 정정 참고)
- [x] **Step 2**: 공통 리졸버 신설 — `packages/business/src/project-resolver.ts`(이미 유사 함수 `resolveDomainProjectId`가 있으면 그것으로 통일하고 신설 금지):
```ts
export async function resolveDefaultProjectId(prismaClient = prisma): Promise<string> {
  // 우선순위: env DEFAULT_PROJECT_ID → DB 유일 Project → 없으면 명시적 에러 (조용한 demo 폴백 금지)
}
```
✅ `packages/business/src/default-project.ts`에 `resolveDefaultProjectId`/`resolveDefaultProjectSlug` 신설(기존 `resolveDomainProjectId`는 도메인-AI 전용 별개 함수라 재사용 대상 아님으로 판단). 라이브 DB 검증에서 잡힌 가짜 `deletedAt` 필터 제거 + where절 회귀 가드 포함.
- [x] **Step 3**: 18곳을 리졸버 호출로 치환. 시드/테스트 코드 내 사용은 유지 가능하되 주석으로 표기. ✅ 프론트 17곳 + `dashboard/[role]`·`daily-report` 등 중앙해석점 치환. B그룹 76곳은 미치환(위 정정 참고).
- [x] **Step 4**: `grep -rn '"demo-project"'`가 시드/테스트 외 0건인지 확인 → 커밋. ✅ `apps/web` 잔존 0건 확인. `packages/business` 잔존은 이월 항목으로 기록(0건 아님 — 정정).

### Task C-3: 메일 파생후보 파이프라인 가동 (약 1,081건)

**배경**: 후보가 전부 미승인으로 적체 — 파이프라인(분류→승인큐→전환)이 "존재하나 가동 안 됨" 상태.

> ✅ 2026-07-07 **핵심 발견**: 분류기 신뢰도가 타입별 상한(customer 74·partner 82·opportunity 84·poc 80·task 78)을 갖는 이산 스코어라 **1,079건 중 0건이 게이트 기준 ≥85를 넘지 못함**(NULL/누락 문제 아님, 구조적 상한). 게다가 `isProjectCandidateType()`(`packages/business/src/mail/classify-rules.ts:164`)가 재검증 대상을 `task|opportunity|poc`로만 한정해 **customer/partner(전체의 약 41%)는 AI 재검증 경로 자체가 없음**. 이 두 구조적 결함 때문에 적체 자체의 해소는 **05 문서(3차 고도화)로 이월**하고, 이번 라운드는 파이프라인 자체가 실제로 동작함(수동 가동 + 전환 3건)을 증명하는 데 그쳤다. 상세: `.agents/results/2026-07-07-wp-c3-pipeline.md`.

- [x] **Step 1: 현황 채집** — `SELECT status, count(*) FROM mail_derived_candidates GROUP BY status;` 결과를 증거 파일에 기록. ✅ proposed 1,079 / converted 166 / knowledge_only 18 (합계 1,263)
- [x] **Step 2: 배치 AI 분류 실행** — 기존 `ai-classify-batch.ts`(withBackoff+mapPool, 429 내성) 경로로 미분류 후보 전량 분류. 9router 기동 확인 후:
```bash
# 기존 배치 진입점 확인: grep -rn "ai-classify-batch\|classifyWithAI" packages/business/src apps/web/src/app/api
# web API 경유가 정석: POST /api/mail-candidates/batch (소량 샘플 10건으로 먼저 시험 → 전량)
```
✅ 실행 및 샘플 22건 실 9router 재검증 완료(위 핵심 발견 참고). literal `minConfidence=85` 배치 승인 호출 결과 0건(정직하게 기록, 임계값 임의 하향 안 함).
- [x] **Step 3: 승인 큐 노출 확인** — `/approvals` 및 my-work 코크핏 전표승인큐에 분류 결과가 뜨는지. 고신뢰(예: confidence ≥ 0.9) 후보는 큐 상단 정렬. ✅ `/my-work` 코크핏 "승인 대기 1074" 반영 확인(스크린샷)
- [x] **Step 4: 전환 파이프 검증** — 승인된 후보 3건을 `POST /api/mail-candidates/convert`로 실엔티티 전환하고 CRM 화면에서 확인. ✅ 전환 3건(신규 기회 PRJ-2026-0208/0209 + 고객 "Gsenc" 기존 행 병합) — `/deals`·`/customers` 화면 확인. `minConfidence=85`가 데이터셋 실측 상한(84)보다 높아 예외적으로 84로 상위 2건 배치전환 + 1건은 개별 승인 경로 사용(근거 문서화).
- [x] **Step 5**: 이 배치를 1회성으로 끝내지 않기 위한 잔여 작업은 **3차 고도화(05 문서, 상시 스케줄)**로 이월 — 여기서는 수동 1회 가동 + 큐 정상화까지. ✅ 이월 기록 완료(`backlog.md`)

**Acceptance:** 미분류 후보 0건, 승인 큐가 실분류 결과로 채워짐, 전환 3건 이상 성공 증거.
🔶 **부분충족**: 승인 큐 실분류 반영 + 전환 3건 이상은 충족. **"미분류 후보 0건"은 미충족** — 신뢰도 상한(84<85)·customer/partner 재검증 경로 부재로 1,074건이 여전히 `proposed` 상태(위 핵심 발견 참고, 05 문서로 이월).

### Task C-4: 재무 ↔ engagement 연결 (현금흐름 179건 연결 0)

- [x] **Step 1**: 연결 규칙 확인 — 기존 `POST /api/cfo/cashflows/rematch`(거래처명 정규화 매칭)가 FinanceProject 축이므로, FinanceProject↔Engagement 매핑이 필요. `Invoice/Expense/TaxInvoice.engagementId`는 이미 스키마에 있다(프로젝트 허브 Phase 1). ✅
- [x] **Step 2**: 백필 스크립트 작성 `packages/db/scripts/backfill-finance-engagement.ts`:
  거래처명(정규화) ↔ `Engagement.customerId→Customer.name` 매칭으로 `engagementId` 채움. dry-run 기본(`APPLY=1`일 때만 쓰기), 매칭 결과 리포트(매칭/미매칭/모호 3분류) 출력. ✅ FinanceProject 브리지 7/17 매핑, 모호 0
- [x] **Step 3**: `cfo:snapshot` → dry-run 리포트 검토 → APPLY=1 실행 → 프로젝트 허브 손익(`computePnl`)에 실데이터 반영 확인. ✅ `APPLY=1` 실행 완료, 재무 19행 연결, 프로젝트 허브 손익에 실값 반영
- [ ] **Step 4**: 고객 `domain` 백필(감사 P2) — ground-truth 분류(고객15·파트너49)의 도메인을 Customer/Partner 행에 채우는 스크립트. 동일한 dry-run 규칙. **미착수** — 이번 라운드(PR #100) diff에 해당 스크립트 없음. `backlog.md`에 이월 기록.

**Acceptance:** cashflow/invoice/expense의 engagement 연결율 리포트 존재(목표: 매칭 가능한 건 전부 연결, 모호 건은 목록화), 프로젝트 허브 손익이 0이 아닌 실값 렌더.
🔶 **부분충족**: 연결 리포트 존재 + 재무 19행 연결 + 손익 실값 렌더는 충족(Step 1-3). 고객 domain 백필(Step 4)은 미착수.

---

## WP-D: 화면 마감 (준비중 마커 해소)

**브랜치**: `fix/screen-honesty`
**원칙(DESIGN.md)**: "계기는 정직" — 실데이터를 연결하거나, 연결할 수 없으면 그 섹션을 **제거**한다. "준비 중" 라벨을 남기는 것은 실패.

### Task D-1: 준비중 마커 전수 목록화
- [x] `grep -rn "준비 중\|준비중\|coming soon\|TODO" apps/web/src/app --include='*.tsx' | tee /tmp/wip-markers.txt` → 각 항목에 처리 방침(연결/제거) 기록. ✅ 2026-07-07 (PR #98)

### Task D-2: 경영 대시보드 AI 어시스턴트
- [x] 커맨드 핸들러 플레이스홀더를 실경로로: 입력 → `POST /api/agent/run`(기존 에이전트 실행 API) → 실행 결과/링크 반환. 1주 내 연결이 어려우면 입력창 자체를 제거(방침을 커밋 메시지에 명시). `ACTIVITIES`/`STATS` 빈 배열은 실쿼리로 대체하거나 카드 제거. ✅ 공유 클라이언트(`agent-command-client`)로 6개 워크벤치(경영/영업/프리세일즈/딜리버리/오퍼레이터/보안) 전부 `POST /api/agent/run`(SSE) 실배선, 정직한 실패/차단/max-steps 문구 — "준비 중" 폴백 제거. 라이브 검증: 커맨드바 실행 → 200 응답 + 정직한 실패 토스트, 콘솔 에러 0(`.agents/results/2026-07-07-wp-d-live.md`)

### Task D-3: presales / sales / delivery / operator / security 워크벤치
- [x] 각 화면의 준비중 섹션을 실데이터 소스에 연결: presales→PocProject/GeneratedDocument, sales→Opportunity/Quote(WP-B 헬퍼), delivery→Engagement/DeliveryChecklistItem, operator→unified-health + MCP 헬스(:3500/:3502/:3600), security→AuditLog/ApprovalRequest. 연결 불가 섹션은 제거. ✅ security는 `calculateSecurityDashboard` 실데이터 파생 타일 + 정직한 빈 피드로 교체(합성 이벤트/통계 제거, 기존 렌더 타입불일치 크래시도 해소). contacts/deals/customers의 비활성 스텁 버튼(필터/열설정/"복사 (준비 중)") 제거, 딜 헤더 라벨을 활성 필터 칩과 동기화(WP-B 관찰사항 반영).
- [x] 화면별 스크린샷 검증(playwright-verify) → 증거 저장. ✅ 라이브 QA 전부 PASS: 17페이지 콘솔 에러 0, dev-smoke 10/10(web)+2/2(api), `.agents/results/2026-07-07-wp-d-live.md`. **참고**: 잔존 "준비 중" 표기 2건은 UI 플레이스홀더가 아니라 계약상태 배지 등 실제 도메인 상태값(정상, 목록 제외 대상 아님).

**Acceptance:** `/tmp/wip-markers.txt` 전 항목이 "연결됨" 또는 "제거됨". prod 빌드 통과 + 전 화면 스크린샷.
✅ 2026-07-07 충족. PR #98 머지 (squash `0a5d291`).

---

## WP-E: IA 정리 (감사 P3)

**브랜치**: `refactor/ia-consolidation`
**선행**: WP-C (실데이터 기준으로 메뉴를 정해야 함).

> ✅ 2026-07-07 **E-1/E-2 커밋, PR #101 머지 완료** — `state: MERGED`, `mergedAt: 2026-07-07T10:44:29Z`, merge commit `22de4b5`(`gh pr view 101 --json state,mergedAt,mergeCommit`로 확인). 이 문서 워크트리는 이후 origin/main(#101 포함)으로 리베이스됨.

### Task E-1: 딜 진입점 단일화
- [x] `/deals`와 `/opportunities`가 동일 컴포넌트를 렌더하는 중복 확인(감사 지적). **`/deals`를 canonical로 유지**(계기판 딜 워크스페이스), `/opportunities`는 `redirect('/deals')` + 상세는 `/deals/[id]`로. 사이드바(`PortalShell` 네비 정의)에서 기회 메뉴 제거. ✅ `next.config.ts`의 `redirects()`로 `/opportunities`(+상세) → `/deals`(+상세) 실 307 처리, 별도 "파이프라인" CRM 메뉴 제거. **부가 발견**: `(portal)/loading.tsx` 스트리밍 컨텍스트에서 page-level `redirect()`가 meta-refresh로 강등되는 Next 16 동작 때문에 config-level redirect로 전환(DEV_REFERENCE §8 참고).
- [x] 내부 링크 전수 치환: `grep -rn 'href="/opportunities' apps/web/src`. ✅ 잔존 0건(curl로 5라우트 307+Location 검증)

### Task E-2: 메일 화면 3분산 통합
- [x] `/inbox`(계기판 인입함)를 단일 진입으로. `/mail-intelligence`·`/development/mail-candidates`의 고유 기능(스레드 인사이트, 후보 디버그 뷰)은 inbox의 탭 또는 상세 패널로 흡수하고 구 라우트는 redirect. `/mail-connection`(OAuth 설정)은 설정 아래로 이동. ✅ `/inbox`에 "인입/후보 관리" 탭 신설, mail-intelligence 지표 흡수 + `MailCandidatesList`로 후보관리 뷰 흡수, `/mail-connection` → `/settings/mail-connection` 이동(OAuth authorize/callback 목적지 갱신)

### Task E-3: 고아 페이지 제거
- [x] 감사 문서의 고아 페이지 목록(가짜 Ops Portal 등) 확인 → 사이드바에 없고 실데이터도 없는 페이지 삭제. 삭제 전 `grep -rn "<라우트명>"`으로 참조 0 확인. ✅→**정정**: 감사가 지목한 고아 페이지 4곳을 전수 실사한 결과 **전부 실참조·실기능을 보유** — 예: `/cfo/settings`는 `CFO_NAV`에 실제로 연결돼 있음. 따라서 계획대로 "삭제"하지 않고 **연결/유지로 방침 변경**(감사 문서와 실상의 차이를 정직하게 기록, 참조 0건 확인이 안 돼 삭제를 보류한 것과 동일한 효과).

**Acceptance:** 사이드바 메뉴 수 감소, 중복 라우트 0, 모든 메뉴가 실데이터 화면으로 연결. e2e/스모크 통과.
✅ 2026-07-07 충족 — web typecheck 클린, lint 신규 0, build 성공, e2e 67 passed/0 failed(변경 전 베이스라인과 동일), href="/opportunities" 잔존 0건. PR #101 머지 완료(2026-07-07T10:44:29Z, `22de4b5`) — main 반영 확인.

---

## v1 완성의 정의 (Definition of Done)

아래 전부가 참이면 v1 완성으로 선언하고 02 검증서의 **릴리스 검증 체크리스트**를 실행한다:

> **2026-07-07 현재 상태 — 항목별 정직 판정** (아래 원문 조건은 불변, 이 인용 블록만 주석):

1. WP-A~E의 PR 5개가 main에 머지되고 각 Acceptance가 증거 파일로 남아 있다.
   🔶 **부분충족(사유 갱신)** — **PR 5개(#96~#98, #100, #101) 전부 main 머지 완료**로 정정: WP-E(#101)는 2026-07-07T10:44:29Z 머지(merge commit `22de4b5`, `gh pr view 101 --json state,mergedAt,mergeCommit`로 확인). "E 미머지" 사유는 해소됨. 별도로 CI e2e를 실차단 체크로 승격한 #99도 이 웨이브에 포함되어 사실상 6개 PR이 이 작업의 일부였다. **다만 남은 사유**: WP-A/B/C/D는 `.agents/results/2026-07-07-wp-{a,b,c,d}-*.md` 전용 증거 파일이 있는 반면, **WP-E는 전용 증거 파일이 없고**(`.agents/results/`에 wp-e 관련 파일 부재 확인) 검증 근거가 PR #101 본문 서술(typecheck/lint/build/e2e/grep 결과)에만 남아 있다 — "각 Acceptance가 증거 파일로 남아 있다"는 조건은 엄밀히는 완전 충족이 아니라서 부분충족으로 유지.
2. `pnpm lint && typecheck && test && build` + `CI_INTEGRATION=1` 통합 + `pnpm test:e2e` 전부 green.
   ✅ **충족** — WP-A/WP-C 게이트 각 6/6 green(`.agents/results/2026-07-07-{wp-a-gates,wp-c-gates}.md`), e2e는 #99로 실차단화되어 67 passed/0 failed(PR #101 검증에서도 동일 베이스라인 재확인).
3. 진행중 딜 수치가 전 화면에서 일치한다 (02 검증서 SQL 체크 C-1).
   ✅ **충족** — 5표면 전부 DB 기준값 56과 일치(`.agents/results/2026-07-07-wp-b-consistency.md`).
4. 메일 후보 적체 0, 재무-engagement 연결 리포트 존재, `"demo-project"` 잔존 0(시드 제외).
   🔶 **부분충족** — 재무-engagement 연결 리포트는 존재(재무 19행 연결, 매칭/미매칭/모호 3분류). 그러나 **메일 후보 적체는 0이 아님**(1,074건 여전히 `proposed` — 분류기 신뢰도 상한 84 < 게이트 85, customer/partner 재검증 경로 부재로 05 문서 이월) 및 **`"demo-project"` 잔존도 0이 아님**(웹 프론트 17곳은 0건이지만 business 내부 B그룹 약 76곳 미치환, 06 문서 이월).
5. "준비 중" 마커 0건. 사이드바의 모든 메뉴가 실화면.
   🔶 **부분충족** — UI 플레이스홀더성 "준비 중"/coming-soon 마커는 0건(WP-D). 다만 계약상태 배지 등 **실제 도메인 상태값**으로서의 "준비 중" 표기 2건이 남아 있음(정상 동작, 마커 목록의 취지와는 다른 케이스지만 문자열 검색 시 잡힘 — 정직하게 병기).
6. 프로젝트 허브에서 제안 생성→5렌즈 verdict→사람 승인→문서 승격→자율도 갱신 루프가 라이브로 재연된다.
   ✅ **충족(부분은 기존 검증 재사용)** — 이번 라운드에서 제안 승인→brass 링크→문서 v1 승격까지는 라이브 재검증(`.agents/results/2026-07-07-wp-a3-live.md`). 자율도(`computeAutonomy`) 갱신 자체는 이번 라운드에서 별도로 재연하지 않았고 프로젝트 허브 Phase 2(2026-06-30, DEV_REFERENCE §3.J)에서 기 검증된 것을 근거로 삼는다.
