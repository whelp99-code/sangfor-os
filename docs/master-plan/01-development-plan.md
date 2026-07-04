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

- [ ] **Step 1: 컬럼이 마이그레이션에 포함되어 있는지 확인**
```bash
grep -rn "colorGateJson\|resolvedAt\|resolvedBy" packages/db/prisma/migrations/ | head
```
Expected: PR #94에서 생성된 마이그레이션에 3컬럼의 `ALTER TABLE "domain_decision_logs" ADD COLUMN ...`이 존재.
- [ ] **Step 2-A (존재하면)**: 로컬 DB에 적용 여부 확인 후 종료.
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
- [ ] **Step 3: 검증** — `pnpm --filter @sangfor/db db:migrate:deploy`가 empty-diff/clean으로 끝나는지 확인.

**Acceptance:** fresh DB에서 `migrate deploy`만으로 `colorGateJson` 컬럼이 생긴다. `prisma migrate status`에 drift 없음.

### Task A-2: `proposal-promote` 통합 테스트

**Files:**
- Create: `packages/business/src/domain-ai/proposal-promote.test.ts`
- 참고(팩토리 재사용): `packages/business/src/engagement-conversion.test.ts` — project/customer/opportunity/engagement 생성에 필요한 필수 필드는 이 파일의 팩토리를 그대로 복사한다(추측으로 필드를 새로 쓰지 말 것).

**Interfaces (테스트 대상):**
- `promoteDomainProposalToDocument(input: {engagementId, domain, title, bodyMarkdown, status?}) => Promise<{documentId} | null>`
- 체인 없으면 null(비파괴), 있으면 `DocumentTemplate`(projectId+templateKey `domain-ai` upsert) → `GeneratedDocument`(status 기본 `approved`) → `DocumentVersion`(version 1).

- [ ] **Step 1: 실패하는 테스트 작성** — `CI_INTEGRATION=1` 게이트, 공유 DB이므로 생성 데이터는 전부 `test-promote-` prefix + afterAll 정리.
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
- [ ] **Step 2: 실패 확인** — `CI_INTEGRATION=1 pnpm --filter @sangfor/business exec vitest run src/domain-ai/proposal-promote.test.ts` → 팩토리 미완성 상태에선 FAIL이 정상.
- [ ] **Step 3: 팩토리 완성 → 통과 확인** — 같은 명령, Expected: 3 passed.
- [ ] **Step 4: 전체 게이트** — `pnpm --filter @sangfor/business test` (기존 68개 파일 무손상).

**Acceptance:** 통합 3케이스 통과 + 비통합 환경(`CI_INTEGRATION` 미설정)에서 skip 처리.

### Task A-3: 승격 문서 링크 UI 소비

**Files:**
- Modify: `apps/web/src/app/(portal)/projects/[id]/page.tsx` 및 해당 클라이언트 컴포넌트(레인 결정 컨트롤 — `LaneDecisionControls` 또는 이 페이지가 임포트하는 결정 버튼 컴포넌트. `grep -rn "domain-decision" apps/web/src`로 위치 특정).

**Interfaces:** `POST /api/projects/[id]/domain-decision` 응답에 이미 `documentId?: string`이 포함된다(승격 성공 시).

- [ ] **Step 1**: 승인 성공 응답에서 `documentId`가 있으면 결정 카드 하단에 `<Link href={`/proposals/${documentId}`}>산출물 문서 보기 →</Link>` 렌더 (계기판 톤: brass 텍스트 링크, 새 배지 금지 — DESIGN.md "계기는 정직").
- [ ] **Step 2**: `/proposals/[id]` 상세가 GeneratedDocument id를 렌더하는지 확인(`apps/web/src/app/(portal)/proposals/[id]/page.tsx`). 아니면 링크 target을 실제 상세 라우트에 맞춘다.
- [ ] **Step 3**: 수동 검증 — `scripts/dev-up.sh` → 프로젝트 허브에서 pending 제안 승인 → 링크 클릭 → 문서 v1 본문 확인. 스크린샷 저장(playwright-verify 스킬).

**Acceptance:** 승인 → 문서 링크 노출 → 클릭 시 승격된 문서가 열린다. 체인이 없어 승격이 스킵된 경우 링크가 안 뜨고 에러도 없다.

### Task A-4: 커밋 분할 + PR 출하

- [ ] **Step 1**: 커밋 3개로 분할:
```bash
git checkout -b feat/color-gate-llm-loop
git add packages/business/src/domain-ai/color-gate-llm.ts packages/business/src/domain-ai/color-gate-llm.test.ts packages/business/src/domain-ai/index.ts
git commit -m "feat(domain-ai): LLM 5-lens color gate verdict for domain proposals"
git add packages/business/src/domain-ai/proposal-promote.ts packages/business/src/domain-ai/proposal-promote.test.ts packages/business/src/project-decision.ts packages/business/src/domain-ai/domain-proposal.ts packages/business/src/artifact-domain-map.ts
git commit -m "feat(domain-ai): promote approved proposals to GeneratedDocument + close decision queue"
git add "apps/web/src/app/(portal)/projects/[id]/page.tsx"
git commit -m "feat(web): color gate lens chips + promoted document link on project hub"
```
- [ ] **Step 2**: `.env.bak.9router`는 커밋하지 않는다(로컬 백업). `next-env.d.ts` diff는 `git checkout -- apps/web/next-env.d.ts`로 버린다.
- [ ] **Step 3**: 게이트 4종 + 통합 테스트 실행, 출력 확인.
- [ ] **Step 4**: `scripts/round-ship.sh feat/color-gate-llm-loop "feat(domain-ai): color-gate LLM verdict + proposal promotion loop" "<본문: 위 3커밋 요약 + 검증 증거>"`
- [ ] **Step 5**: `gh pr checks --watch` → 머지 확인 → `.agents/results/2026-07-XX-wp-a-ship.md`에 증거 기록.

**Acceptance:** PR 머지, main에서 게이트 4종 green, 라이브에서 제안 생성 시 `colorGateJson` 비-null.

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
- [ ] **Step 1**: 실패 테스트 — DB에 실재하는 raw 변형(감사 문서에 나온 표기 흔들림 예시)을 케이스로: 대소문자·공백·한/영 변형이 전부 같은 canonical로 정규화되는지, WON/LOST/CLOSED류가 active=false인지.
- [ ] **Step 2**: 구현. canonical 집합은 Prisma `OpportunityStage` enum과 감사 문서의 실데이터 분포(`SELECT stage, count(*) FROM opportunities GROUP BY stage`)를 대조해 결정. 애매하면 "PROPOSAL/POC/NEGOTIATION/QUALIFIED류 = active, WON/LOST/보류 = inactive"를 기본으로 하고 판단 근거를 테스트 주석에 남긴다.
- [ ] **Step 3**: 테스트 통과 → 커밋 `feat(crm): canonical active-stage helper (single source for deal metrics)`.

### Task B-2: 5개 소비처 치환

**Files (감사 문서에서 file:line 확정):**
- Modify: 홈 깔때기(`apps/web/src/app/(portal)/home/page.tsx`), 경영 대시보드 데이터 소스(`packages/business/src/role-dashboard.ts` 또는 `apps/web/src/app/api/dashboard/[role]/route.ts`), 딜 목록(`(portal)/deals/page.tsx`), 기회 목록(`(portal)/opportunities/page.tsx`), 일일 리포트(`api/daily-report/route.ts`).

- [ ] **Step 1**: 각 소비처의 인라인 스테이지 필터를 `isActiveOpportunity`/`ACTIVE_OPPORTUNITY_STAGES`로 치환. Prisma where절에는 `stage: { in: [...ACTIVE_OPPORTUNITY_STAGES] }` 형태로.
- [ ] **Step 2**: 홈 깔때기 죽은 칸(③⑤⑥ 항상 0) — 미매핑 enum을 `normalizeOpportunityStage` 기반 매핑표로 연결. 매핑 불가 스테이지는 "기타" 칸으로 정직 표기(0 고정 칸 금지).
- [ ] **Step 3**: executive 대시보드 소문자 키 버그 — 감사 문서 지목 위치에서 키 정규화 수정.
- [ ] **Step 4: 정합 검증(핵심)** — dev 스택 기동 후 4화면(홈/대시보드/딜/기회)과 daily-report API의 "진행중 딜" 수가 **모두 동일**한지 확인하고 숫자를 증거로 기록:
```bash
scripts/dev-up.sh
# 각 화면 스크린샷 + curl로 API 수치 채집 → .agents/results/2026-07-XX-wp-b-consistency.md
```
- [ ] **Step 5**: 커밋 `fix(metrics): unify active-deal counting across 5 surfaces` → PR 출하.

**Acceptance:** 동일 시점 조회에서 5개 표면의 진행중 딜 수가 완전히 일치. golden/특성화 테스트(Phase 0) 통과 유지.

---

## WP-C: 프로젝트 모델 현실화 + 데이터 섬 연결 (감사 P1/P2)

**브랜치**: `feat/data-island-bridge`
**선행**: WP-B 머지 (스테이지 헬퍼 사용).

### Task C-1: 프로젝트 선택기 현실화 (MOCK_PROJECTS 제거)

**Files:** `grep -rn "MOCK_PROJECTS" apps/web/src` 로 특정 (감사 기준: 프로젝트 선택기 컴포넌트).

- [ ] **Step 1**: 결정 반영 — 감사 권고대로 **단일 프로젝트 확정** 모델: DB `Project` 테이블의 실제 행을 조회해 렌더하고, 하드코딩 배열 삭제. 프로젝트가 1개면 선택기는 고정 라벨로 렌더(가짜 선택지 금지).
- [ ] **Step 2**: 선택된 projectId가 대시보드/일일리포트 조회 where절에 실제로 전달되는지 배선(감사: project 필터 부재). `dashboard/[role]` route와 `daily-report` route에 `projectId` 쿼리 파라미터 추가 → business 함수까지 관통.
- [ ] **Step 3**: 테스트 — role-dashboard 계산 함수에 projectId 스코프 케이스 추가.

### Task C-2: `"demo-project"` 하드코딩 정리 (P18, 18곳)

- [ ] **Step 1**: `grep -rn '"demo-project"' --include='*.ts' --include='*.tsx' apps packages | tee /tmp/demo-refs.txt` — 18곳 전수 목록화.
- [ ] **Step 2**: 공통 리졸버 신설 — `packages/business/src/project-resolver.ts`(이미 유사 함수 `resolveDomainProjectId`가 있으면 그것으로 통일하고 신설 금지):
```ts
export async function resolveDefaultProjectId(prismaClient = prisma): Promise<string> {
  // 우선순위: env DEFAULT_PROJECT_ID → DB 유일 Project → 없으면 명시적 에러 (조용한 demo 폴백 금지)
}
```
- [ ] **Step 3**: 18곳을 리졸버 호출로 치환. 시드/테스트 코드 내 사용은 유지 가능하되 주석으로 표기.
- [ ] **Step 4**: `grep -rn '"demo-project"'`가 시드/테스트 외 0건인지 확인 → 커밋.

### Task C-3: 메일 파생후보 파이프라인 가동 (약 1,081건)

**배경**: 후보가 전부 미승인으로 적체 — 파이프라인(분류→승인큐→전환)이 "존재하나 가동 안 됨" 상태.

- [ ] **Step 1: 현황 채집** — `SELECT status, count(*) FROM mail_derived_candidates GROUP BY status;` 결과를 증거 파일에 기록.
- [ ] **Step 2: 배치 AI 분류 실행** — 기존 `ai-classify-batch.ts`(withBackoff+mapPool, 429 내성) 경로로 미분류 후보 전량 분류. 9router 기동 확인 후:
```bash
# 기존 배치 진입점 확인: grep -rn "ai-classify-batch\|classifyWithAI" packages/business/src apps/web/src/app/api
# web API 경유가 정석: POST /api/mail-candidates/batch (소량 샘플 10건으로 먼저 시험 → 전량)
```
- [ ] **Step 3: 승인 큐 노출 확인** — `/approvals` 및 my-work 코크핏 전표승인큐에 분류 결과가 뜨는지. 고신뢰(예: confidence ≥ 0.9) 후보는 큐 상단 정렬.
- [ ] **Step 4: 전환 파이프 검증** — 승인된 후보 3건을 `POST /api/mail-candidates/convert`로 실엔티티 전환하고 CRM 화면에서 확인.
- [ ] **Step 5**: 이 배치를 1회성으로 끝내지 않기 위한 잔여 작업은 **3차 고도화(05 문서, 상시 스케줄)**로 이월 — 여기서는 수동 1회 가동 + 큐 정상화까지.

**Acceptance:** 미분류 후보 0건, 승인 큐가 실분류 결과로 채워짐, 전환 3건 이상 성공 증거.

### Task C-4: 재무 ↔ engagement 연결 (현금흐름 179건 연결 0)

- [ ] **Step 1**: 연결 규칙 확인 — 기존 `POST /api/cfo/cashflows/rematch`(거래처명 정규화 매칭)가 FinanceProject 축이므로, FinanceProject↔Engagement 매핑이 필요. `Invoice/Expense/TaxInvoice.engagementId`는 이미 스키마에 있다(프로젝트 허브 Phase 1).
- [ ] **Step 2**: 백필 스크립트 작성 `packages/db/scripts/backfill-finance-engagement.ts`:
  거래처명(정규화) ↔ `Engagement.customerId→Customer.name` 매칭으로 `engagementId` 채움. dry-run 기본(`APPLY=1`일 때만 쓰기), 매칭 결과 리포트(매칭/미매칭/모호 3분류) 출력.
- [ ] **Step 3**: `cfo:snapshot` → dry-run 리포트 검토 → APPLY=1 실행 → 프로젝트 허브 손익(`computePnl`)에 실데이터 반영 확인.
- [ ] **Step 4**: 고객 `domain` 백필(감사 P2) — ground-truth 분류(고객15·파트너49)의 도메인을 Customer/Partner 행에 채우는 스크립트. 동일한 dry-run 규칙.

**Acceptance:** cashflow/invoice/expense의 engagement 연결율 리포트 존재(목표: 매칭 가능한 건 전부 연결, 모호 건은 목록화), 프로젝트 허브 손익이 0이 아닌 실값 렌더.

---

## WP-D: 화면 마감 (준비중 마커 해소)

**브랜치**: `fix/screen-honesty`
**원칙(DESIGN.md)**: "계기는 정직" — 실데이터를 연결하거나, 연결할 수 없으면 그 섹션을 **제거**한다. "준비 중" 라벨을 남기는 것은 실패.

### Task D-1: 준비중 마커 전수 목록화
- [ ] `grep -rn "준비 중\|준비중\|coming soon\|TODO" apps/web/src/app --include='*.tsx' | tee /tmp/wip-markers.txt` → 각 항목에 처리 방침(연결/제거) 기록.

### Task D-2: 경영 대시보드 AI 어시스턴트
- [ ] 커맨드 핸들러 플레이스홀더를 실경로로: 입력 → `POST /api/agent/run`(기존 에이전트 실행 API) → 실행 결과/링크 반환. 1주 내 연결이 어려우면 입력창 자체를 제거(방침을 커밋 메시지에 명시). `ACTIVITIES`/`STATS` 빈 배열은 실쿼리로 대체하거나 카드 제거.

### Task D-3: presales / sales / delivery / operator / security 워크벤치
- [ ] 각 화면의 준비중 섹션을 실데이터 소스에 연결: presales→PocProject/GeneratedDocument, sales→Opportunity/Quote(WP-B 헬퍼), delivery→Engagement/DeliveryChecklistItem, operator→unified-health + MCP 헬스(:3500/:3502/:3600), security→AuditLog/ApprovalRequest. 연결 불가 섹션은 제거.
- [ ] 화면별 스크린샷 검증(playwright-verify) → 증거 저장.

**Acceptance:** `/tmp/wip-markers.txt` 전 항목이 "연결됨" 또는 "제거됨". prod 빌드 통과 + 전 화면 스크린샷.

---

## WP-E: IA 정리 (감사 P3)

**브랜치**: `refactor/ia-consolidation`
**선행**: WP-C (실데이터 기준으로 메뉴를 정해야 함).

### Task E-1: 딜 진입점 단일화
- [ ] `/deals`와 `/opportunities`가 동일 컴포넌트를 렌더하는 중복 확인(감사 지적). **`/deals`를 canonical로 유지**(계기판 딜 워크스페이스), `/opportunities`는 `redirect('/deals')` + 상세는 `/deals/[id]`로. 사이드바(`PortalShell` 네비 정의)에서 기회 메뉴 제거.
- [ ] 내부 링크 전수 치환: `grep -rn 'href="/opportunities' apps/web/src`.

### Task E-2: 메일 화면 3분산 통합
- [ ] `/inbox`(계기판 인입함)를 단일 진입으로. `/mail-intelligence`·`/development/mail-candidates`의 고유 기능(스레드 인사이트, 후보 디버그 뷰)은 inbox의 탭 또는 상세 패널로 흡수하고 구 라우트는 redirect. `/mail-connection`(OAuth 설정)은 설정 아래로 이동.

### Task E-3: 고아 페이지 제거
- [ ] 감사 문서의 고아 페이지 목록(가짜 Ops Portal 등) 확인 → 사이드바에 없고 실데이터도 없는 페이지 삭제. 삭제 전 `grep -rn "<라우트명>"`으로 참조 0 확인.

**Acceptance:** 사이드바 메뉴 수 감소, 중복 라우트 0, 모든 메뉴가 실데이터 화면으로 연결. e2e/스모크 통과.

---

## v1 완성의 정의 (Definition of Done)

아래 전부가 참이면 v1 완성으로 선언하고 02 검증서의 **릴리스 검증 체크리스트**를 실행한다:
1. WP-A~E의 PR 5개가 main에 머지되고 각 Acceptance가 증거 파일로 남아 있다.
2. `pnpm lint && typecheck && test && build` + `CI_INTEGRATION=1` 통합 + `pnpm test:e2e` 전부 green.
3. 진행중 딜 수치가 전 화면에서 일치한다 (02 검증서 SQL 체크 C-1).
4. 메일 후보 적체 0, 재무-engagement 연결 리포트 존재, `"demo-project"` 잔존 0(시드 제외).
5. "준비 중" 마커 0건. 사이드바의 모든 메뉴가 실화면.
6. 프로젝트 허브에서 제안 생성→5렌즈 verdict→사람 승인→문서 승격→자율도 갱신 루프가 라이브로 재연된다.
