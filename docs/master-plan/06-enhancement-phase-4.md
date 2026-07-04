# 4차 고도화 계획서 — 플랫폼 통합: 재구조화·API 통일·DB·관측성 (06)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 이 차수의 Task 1~3은 각각 실행 정본 문서(`docs/superpowers/plans/2026-07-03-phase-5/6-*.md`)가 있고, **ADR-002(1차 고도화 Task 0에서 확정)가 Phase 6 계열의 정본을 수정한다** — 반드시 ADR-002를 먼저 읽고 실행 문서의 배너를 확인하라. 착수 전 `00-INDEX.md` §3 필독.

**Goal:** 코드베이스를 "여러 시대가 겹친 지층"에서 "한 세대의 플랫폼"으로 — ①business 패키지가 9개 도메인 폴더로 응집, ②API 표면이 단일 규약(ADR-002), ③DB 인덱스·FK가 실쿼리에 맞게 정비, ④비용·성능이 계측되는 상태.

**선행 조건:** 3차 고도화 완료 + 1차 고도화 Task 4(지식 그래프 재학습 — Phase 5 폴더 배치 판단의 근거) + ADR-002 Accepted.

**전역 제약:** 00-INDEX §3. Task 1~2는 행위 보존(`refactor:`), Task 3은 expand-contract(순차, 롤백 가능 단위), golden 무변화.

---

## Task 1: Phase 5 — business 패키지 재구조화 (평면 188파일 → 9폴더)

**실행 정본:** `docs/superpowers/plans/2026-07-03-phase-5-business-restructure.md` (Task 5-1~5-9).
**브랜치:** `refactor/phase-5-business-structure`

- [ ] 5-1 `domain-ai/` (domain-*.ts 19개 — 일부는 이미 이동돼 있음: `color-gate-llm.ts` 등 신파일 기준으로 잔여만) → 5-2 `crm/` → 5-3 `finance/` → 5-4 `governance/` → 5-5 `orchestration/` → 5-6 `support/` → 5-7 `infrastructure/` → 5-8 `platform/`(llm 설정 통합) → 5-9 `phase14/` 제거 + phase11-14 네이밍 전폐.
- [ ] 각 이동 태스크마다: `git mv` → 상대 import 수정 → `index.ts` re-export 경로 갱신(외부 API 불변) → typecheck → 커밋. **한 커밋 = 한 폴더** (리뷰 가능 단위).
- [ ] `package.json` exports map 갱신, `pnpm -r typecheck`로 소비 패키지(web/api) 파손 0 확인.
- [ ] 2차·3차 고도화에서 생긴 신규 파일(`autonomy-policy.ts`, `autopilot.ts`, `watchdog.ts`, `case-ref.ts` 등)의 소속 폴더를 정본 문서 원칙(응집 기준)으로 배정하고 문서의 폴더 표에 추가.

**Acceptance:** `packages/business/src` 1depth에 남는 .ts는 `index.ts`뿐(허용 예외는 정본 문서 목록). 외부 import(`@sangfor/business`) 전부 무변경 통과. golden 무변화.

## Task 2: Phase 6 — API 표면 통일 (ADR-002 반영판)

**실행 정본:** `docs/superpowers/plans/2026-07-03-phase-6-api-unification.md`를 ADR-002가 수정한 버전.
**브랜치:** `refactor/phase-6-api-surface`

ADR-002가 권고 기본값(web=BFF, 미사용 tRPC 제거)으로 확정된 경우:
- [ ] 2-1 실호출자 0인 tRPC 라우터(business/dashboard/mail 계열) 제거 — 제거 전 각 프로시저 `grep -rn "<프로시저명>" apps/web/src`로 호출 0 재확인. CFO tRPC는 apps/api REST로 단일화(정본 문서의 CFO 절).
- [ ] 2-2 공통 응답 포맷 도입(정본 문서 Task 6-1 그대로 유효): `apps/web/src/app/api/_lib/api-response.ts`/`api-error.ts` + `packages/shared/types/api.ts`의 `ApiResponse<T>` — 신규·수정 라우트부터 적용, 기존 라우트는 손대는 김에 전환(빅뱅 금지).
- [ ] 2-3 에러 표준화: 라우트 최상위 try/catch → `api-error.ts`의 매퍼(Prisma P2002→409, 검증 실패→400, 미인증→401) — 스택 노출 금지.
- [ ] 2-4 OpenAPI: tRPC 없이 기존 `GET /api/openapi.json` 확장 — 핵심 표면(§01 문서의 API 인벤토리 중 CRM/메일/프로젝트/승인)부터 스키마 기술, `GET /api/docs`(Swagger UI)로 서빙. Create: `docs/API.md`(표면 지도 + 규약).
ADR-002가 반대로 결론난 경우: 정본 문서 Task 6-1~6-6을 그대로 실행(이 문서의 이 절은 ADR 결론으로 대체).

**Acceptance:** API 표면 지도(docs/API.md)와 실제 라우트가 일치. 죽은 표면 0. 응답 포맷 규약이 lint 가능한 형태(공용 헬퍼 미사용 라우트 목록 스크립트)로 감시됨.

## Task 3: Phase 7 — DB 인덱스·FK 정비 (expand-contract)

**실행 정본:** 마스터 리팩토링 플랜 §Phase 7 (ADR-002 Step 3에서 확정된 범위 — 신규 컬럼류는 5차로 이관됨).
**브랜치:** `chore/phase-7-db-hardening`

- [ ] 3-1 실쿼리 기반 인덱스: 느린 조회 후보 채집(`SELECT ... FROM pg_stat_user_tables/pg_stat_statements` 또는 주요 화면 쿼리의 where/orderBy 목록화) → 마스터 플랜 P14 목록과 대조 → composite index 마이그레이션(각 인덱스마다 근거 쿼리를 migration.sql 주석으로).
- [ ] 3-2 raw SQL 이중정의 해소(P15): `packages/db/prisma/sql/domain_axis_*.sql`의 DDL이 정식 마이그레이션과 겹치는 부분 확인 → 마이그레이션을 정본으로, sql/ 파일은 삭제 또는 "역사 기록" 마킹.
- [ ] 3-3 관계 승격(FK): 문자열 id로만 연결된 관계 중 마스터 플랜 지정분을 Prisma relation으로 승격 — expand(관계 추가·백필) → 검증 → contract(제약 활성) 순. 고아 행은 승격 전 리포트로 사람 확인.
- [ ] 각 단계 전 `cfo:snapshot`, 각 마이그레이션 후 G6 게이트.

**Acceptance:** `migrate status` clean, fresh-DB 재현 통과, 주요 화면 응답 시간 전후 비교표(개선 없어도 수치 기록), 고아 행 0 또는 목록화.

## Task 4: 관측성 — LLM 비용·성능 계측

**Files:** 기존 `LlmCall` 모델 활용(신규 모델 금지 — 스키마 확인 후 부족 필드만 additive), Create: `packages/business/src/llm-metering.ts`
- [ ] 계측 지점: LLM 호출 공통 경로(openai-config 소비처 — Phase 2 Task 5에서 단일화된 `resolveLlmConfig` 경유 호출부)에 후크: model, tokens(응답 usage), latency, caller(도메인/기능), 성공/실패 기록. 9router가 제로비용이어도 **토큰·지연은 기록**(향후 유료 전환 대비 + 품질 상관 분석용).
- [ ] 노출: ai-team 화면에 일/주 호출량·지연 p50/p95·실패율 카드(실쿼리). grafana(:3000)가 살아 있으면 prometheus 지표로도 노출(선택 — 미기동 환경이면 DB 쿼리 카드만).
- [ ] 알람은 만들지 않는다(YAGNI) — 3차의 unified-health degraded 노출로 충분.
**Acceptance:** 컬러게이트 1회 실행 → LlmCall 1행(모델·토큰·지연) → 화면 카드 반영.

## Task 5: 멀티테넌시 준비 (활성화가 아니라 준비)

**배경:** `Tenant`/`Company`/`UserCompanyRole` 모델은 있으나 실사용 미확인. 완전 활성화는 범위 초과 — 이 차수는 "단일 테넌트로 명시적 고정 + 침투 지점 정리"까지만.
- [ ] 실사용 조사: `grep -rn "tenantId" apps packages --include='*.ts' | grep -v schema.prisma | wc -l` — 사용처 지도 작성.
- [ ] 단일 테넌트 명시화: 기본 Tenant 1행 시드 + 신규 쓰기 경로가 tenantId를 채우도록(널 방치 금지). 조회 필터 강제는 하지 않는다(성능·리스크 대비 이득 없음 — 실제 2번째 테넌트 등장 시점에).
- [ ] 재무 RLS(DEV_REFERENCE 백로그): Postgres 비소유 롤 + finance_* RLS 정책 초안을 `docs/master-plan/rls-draft.sql`로 작성만(적용은 사람 승인 후).
**Acceptance:** tenantId 널 신규 행 0(신규 경로), RLS 초안 문서 존재.

---

## 4차 고도화 종료 게이트

- [ ] Task 1~5 PR 머지, 02 검증서 §4 릴리스 체크리스트 전체 실행.
- [ ] 지식 그래프 재학습 재실행(`/understand --full` — Phase 5로 구조가 다시 크게 바뀜).
- [ ] `docs/DEV_REFERENCE.md` §2 시스템 지도·§6 인벤토리 대개편(9폴더 구조 반영) — 이 갱신 자체가 태스크급 작업임을 감안해 chore 에이전트에 위임 가능.
- [ ] services 트랙 확인: Phase 8 대안 트랙(`services-ci.yml`)이 여전히 green인지, workflow console(3500) 컨테이너화 보류 사유가 유효한지 점검만.
