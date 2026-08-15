# sangfor-os 문제점 기반 리팩토링 마스터 플랜

> **작성**: 2026-07-02 · **근거**: 4개 영역(web / business / api·db / 저장소 위생) 전수 감사 + 정량 메트릭(lizard 복잡도, git churn, 테스트/타입 게이트 실측)
> **실행 주체**: 코딩은 별도 모델에 위임. 이 문서가 단일 작업 지시서(single source of work)다.
> **기준선(실측, 2026-07-02)**: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` **전부 통과**. web 프로덕션 빌드도 **통과**(과거 "빌드 파손" 메모는 stale — 현재는 정상).

---

## 0. 실행 모델을 위한 절대 규칙 (가드레일)

리팩토링을 실행하는 모델은 아래를 **모든 작업에서** 지켜야 한다.

1. **행위 보존**: 리팩토링 커밋은 관찰 가능한 행위를 바꾸지 않는다. 버그를 발견하면 그 자리에서 고치지 말고 **별도 `fix:` 커밋/PR로 분리**한다(two hats). Phase S(보안)만 예외적으로 행위 변경이며, 그래서 리팩토링 트랙과 분리되어 있다.
2. **커밋 단위**: 1 변환 = 1 커밋. 커밋 타입: `refactor:`(구조), `test:`(안전망), `fix:`(행위 변경), `chore:`(삭제/툴링). 테스트 변경과 프로덕션 변경을 한 커밋에 섞지 않는다.
3. **검증 게이트(매 커밋)**: `pnpm lint && pnpm typecheck && pnpm test`. Phase 종료 시 추가로 `pnpm build` + `CI_INTEGRATION=1 pnpm test`(DB 필요, `pnpm docker:dev`로 postgres 5434 기동).
4. **실패 시 Mikado**: 한 변환이 2회 이상 실패하면 반쯤 깨진 트리를 끌고 가지 말고 **전체 revert** 후 선행 과제를 먼저 처리한다.
5. **DB 규칙(치명)**: 스키마 변경은 반드시 정식 마이그레이션 파일로. `prisma db push --accept-data-loss` **금지**. 변경 전 `git diff origin/main -- packages/db/prisma/schema.prisma` 확인. 데이터가 있는 실 DB이므로 스키마 통폐합은 expand-contract만 허용.
6. **워크트리 위험**: 이 리포는 다중 워크트리 스래싱 사고 이력이 있다(`docs/DEV_REFERENCE.md` §8). Phase마다 **전용 브랜치를 만들고 조기·자주 커밋**한다. 루트에서 `git checkout main` 시도 금지(main이 다른 워크트리에 점유될 수 있음).
7. **경로 참조**: 아래 모든 파일 경로는 리포 루트 기준. `문제 근거`의 라인 번호는 2026-07-02 시점이므로 실행 시점에 재확인할 것.

---

## 1. 문제점 총람 (심각도 순)

| # | 문제 | 심각도 | 근거 요약 | 해소 Phase |
|---|---|---|---|---|
| P1 | **web 92개 API route 전원 무인증** — 인증 게이트 `apps/web/src/proxy.ts`가 `middleware.ts`로 연결되지 않은 데드코드. 무인증 뮤테이션 61개(DELETE 포함). 과거 무인증 하드삭제 사고 전력 | 🔴 치명 | `apps/web/src/proxy.ts`(import 0건), `middleware.ts` 부재, `opportunities/[id]/route.ts:82` DELETE 등 | **S** |
| P2 | **apps/api 인증 순서 결함** — `/api/whelp99/tools/call`(임의 MCP 툴 호출)과 `/webhooks/outlook`이 auth 미들웨어(`index.ts:163`)보다 먼저 등록되어 무인증 | 🔴 치명 | `apps/api/src/index.ts:124,201` | **S** |
| P3 | **동일 재무 데이터의 경로별 권한 비대칭** — REST CFO는 `financeAccessGuard`(system_admin·finance_manager·ceo) 강제, tRPC CFO는 로그인만 확인(`protectedProcedure`) | 🔴 치명 | `apps/api/src/index.ts:160` vs `apps/api/src/routers/cfo/*` (requireRole 0건) | **S** |
| P4 | **민감 컬럼 노출 정책 불일치** — 세금계산서 REST는 `rawXml/rawResponse` omit, tRPC list는 전체 반환 | 🔴 높음 | `apps/api/src/routes/cfo.ts:157` vs `routers/cfo/tax-invoices.router.ts:11-14` | **S** |
| P5 | **God-file `mail-candidates.ts` 2,260줄** — 전체 business LOC의 15%. 함수 67개, CCN 15 초과 8개(최고 39). 상수+순수분류+AI호출+DB부수효과+엔티티변환 혼재. churn 8회 | 🔴 높음 | `packages/business/src/mail-candidates.ts` | 0→4 |
| P6 | **e2e 스위트 사문화** — `playwright.config.ts`의 `testDir: "./tests/playwright"`가 실존 경로(`tests/e2e/playwright`, spec 11개)와 단절. `testMatch` 대상 3파일은 아예 없음. CI 미실행 | 🔴 높음 | `playwright.config.ts` | **0** |
| P7 | **고churn 핵심 모듈 무테스트** — `opportunity-center.ts`(churn 9), `proposal-generator.ts`(7), `poc-center.ts`(5) 유닛테스트 0 | 🔴 높음 | `packages/business/src/` | **0** |
| P8 | **API 표면 3중화** — 같은 도메인이 web REST(92 route) + apps/api tRPC(124 프로시저) + apps/api REST(83)로 병렬 구현. 대시보드 로직은 매직넘버 `50000`까지 복붙. web은 tRPC를 전혀 소비 안 함 | 🟠 높음 | `apps/web/src/app/api/dashboard/[role]/route.ts:11-22` ≈ `apps/api/src/routers/dashboard.router.ts:9-21` | 3·6 |
| P9 | **God-package `@sangfor/business`** — 96파일/14.7k LOC 평면 구조, 최소 8개 도메인 혼재, `phase11~14` 시간 기반 네이밍, 배럴 `index.ts`(churn 25, 전 리포 1위)가 `export *` 74건 + package.json 서브패스 17개와 이중 진입점 | 🟠 높음 | `packages/business/src/index.ts` | 5 |
| P10 | **LLM 설정 5중 분산** — 키/URL/모델 해석이 `openai-config.ts`·`domain-llm.ts`·`opencode-client.ts`·`llm-settings.ts`·인라인 env 5곳. 기본 모델 2종 상충(`gpt-4o-mini` vs `gpt-5`). `llm-settings.ts`가 `process.env`를 런타임 mutate하는 숨은 결합 | 🟠 높음 | `packages/business/src/llm-settings.ts:59-78` | 2 |
| P11 | **web route에 비즈니스 로직 인라인** — 11개 route가 prisma 직접 사용. `mail-candidates/convert`(196줄 오케스트레이션), `cleanup`(nexias 하드코딩 특례), `dashboard/[role]`(159줄, business에 동일 기능 존재하는데 우회) | 🟠 높음 | `apps/web/src/app/api/` | 3 |
| P12 | **중복 구현 다발** — Outlook 동기화 2벌(`web/lib/outlook-graph.ts` 500줄 vs `business/outlook-sync.ts` — `mail-import/route.ts`가 둘 다 사용·분기), 통화 포맷터 7~8종, 메일 도메인 상수 3~4중, `sanitizeJsonStrings` 2벌, 이메일 도메인 정규화 인라인 8곳, `tech.support@sangfor.com` 판별 4회 중복, apps/api `context.ts` ≒ `context/index.ts` verbatim 중복(전자는 데드) | 🟠 높음 | 각 Phase 표 참조 | 1·2 |
| P13 | **스키마 개념 중복** — "project" 4중(`Project`/`FinanceProject`/`PocProject`/`Engagement`), invoice 2중, subscription 2중, quote line item 2중, asset 3중. `engagementId`류가 관계 없는 plain string. 금액 타입 Int/Decimal 혼재. `project_id` 컬럼이 실제로는 company id | 🟠 높음 | `packages/db/prisma/schema.prisma` (148 모델/2,455줄) | 7 |
| P14 | **인덱스 누락** — `Cashflow` @@index 전무(list가 type/projectId 필터+date desc 정렬), `Invoice`/`Expense`/`TaxInvoice`도 실쿼리 필터 컬럼 미인덱스 | 🟠 중간 | `schema.prisma:1531-1546` 외 | 7 |
| P15 | **마이그레이션 밖 raw SQL 이중 정의** — `prisma/sql/domain_axis_tables.sql`이 정식 마이그레이션(`20260629110000_…`)과 같은 테이블을 CREATE — 적용 경로에 따라 드리프트 | 🟠 중간 | `packages/db/prisma/sql/` | 7 |
| P16 | **죽은 패키지 4+1** — `@sangfor/{cache,proxy-core,security,ui}` 역참조 0건, `@sangfor/application`은 선언만. 메일 분류 관심사가 3개 패키지(business/mail-intelligence/persona)에 분산 | 🟡 중간 | 위생 감사 §1 | 1 |
| P17 | **web 데드코드/목 잔재** — 완전 목 페이지 `approvals/[id]/page.tsx`(621줄, id 무시하고 하드코딩 데모 렌더), 데드 라우트 6개, 데드 컴포넌트 `redesigned-dashboard.tsx`(462줄), MOCK/TODO 마커 133건, `MOCK_USER role:"owner"` | 🟡 중간 | web 감사 §10 | 1 |
| P18 | **`"demo-project"` 하드코딩 테넌트 18곳** | 🟡 중간 | web 감사 §8 | 3 |
| P19 | **God 컴포넌트** — `module-dashboard-client.tsx` 1,489줄(DB 타입 재정의 6종+목데이터+useState 15개), `tax-invoices/page.tsx` 743줄, `deals/[id]/page.tsx` 447줄(business 함수 11종 fetch) | 🟡 중간 | web 감사 §1 | 4 |
| P20 | **툴링 파편화** — TS 5개 버전, vitest v3/v4 혼재, pnpm 10.12.4/10.28.1, Node 20/22, tsconfig base 상속 3/16, `packages/ui`는 Cypress용 루트 tsconfig 상속(오구성), Cypress 툴체인 자체가 죽어 있음 | 🟡 중간 | 위생 감사 §2 | 8 |
| P21 | **CI 갭** — web 빌드가 CI당 4회 중복 실행, 커버리지 미추적, e2e 미실행, services/* 검증 밖(워크스페이스 미포함), `cd.yml`은 echo만 하는 가짜 배포 | 🟡 중간 | `.github/workflows/` | 8 |
| P22 | **스크립트 난립 + 유령 포트** — `scripts/` 64개(일회성 dispatch-phase5/6/7 등), 제거된 finance 포트 4100을 `mock-upstreams.mjs`·`start-integration-stack.mjs`가 여전히 mock | 🟡 낮음 | 위생 감사 §4·§8 | 1 |
| P23 | **VCS 위생** — `.omo/`가 gitignore인데 6파일 추적(모순), `.superpowers/`·`memory/agent-handoffs` 추적, 로컬 브랜치 14+ 난립, stale 워크트리 | 🟡 낮음 | 위생 감사 §3·§7 | 1 |
| P24 | **스냅샷 안전망 편중** — `cfo:snapshot`이 4개 테이블만 백업(taxInvoice·ledger 등 CFO 내부조차 제외, 나머지 144개 모델 무보호) | 🟡 중간 | `packages/db/scripts/cfo-snapshot.ts:21-26` | 7 |
| P25 | **apps/api 타입 탈출 127건** — `routes/cfo.ts` 전면 `req:any/res:any`, REST CFO zod 검증 0건, 모든 예외를 400 고정 + `e.message` 노출, 조용한 `catch {}` 6곳 | 🟡 중간 | api 감사 §5·§7 | 3 |

---

## 2. Phase 실행 순서와 의존 관계

```
Phase S (보안 fix, 행위 변경)  ──┐  즉시. 다른 모든 것보다 먼저.
Phase 0 (안전망 구축)          ──┤  S와 병렬 가능
Phase 1 (데드코드 삭제)         ──┤  0 완료 후 권장(삭제 검증에 e2e 사용)
Phase 8 (툴링/CI 표준화)        ──┘  독립 트랙, 언제든 병렬
        ↓
Phase 2 (중복 통합)  →  Phase 3 (레이어 정리)  →  Phase 4 (God-file 분해)
        ↓                                              ↓
Phase 5 (business 패키지 재편) ← 4의 mail 분해 결과를 사용
        ↓
Phase 6 (API 표면 단일화 — ADR 필요)   Phase 7 (DB expand-contract — 결정 필요)
```

- **병렬 가능**: S ∥ 0 ∥ 8. 1은 0 이후. 2→3→4→5는 순차(같은 파일들을 만짐).
- **6·7은 결정 게이트**(§11) 통과 후에만 착수.
- PR 단위 = Phase 단위(대형 Phase는 하위 트랙별 PR). 브랜치명: `refactor/phase-<n>-<slug>`.

---

## Phase S — 보안 선행 픽스 (행위 변경, `fix:` 커밋)

> 목적: 리팩토링 이전에 라이브 취약점을 막는다. **리팩토링 커밋과 절대 섞지 말 것.** 브랜치 `fix/security-hardening`.

### S-1. web 인증 게이트 연결 (P1)
- **현상**: `apps/web/src/proxy.ts`의 세션 검증 로직을 아무도 import하지 않고, Next.js가 인식하는 `middleware.ts`(또는 `src/middleware.ts`)가 없다. 결과: web의 92개 route 전부 무인증. 61개가 뮤테이션.
- **작업**:
  1. `apps/web/src/middleware.ts` 신설 — `proxy.ts`의 로직을 이관·연결(NextAuth 세션 확인). matcher는 `/api/:path*` + 포털 페이지. 공개 예외 목록(OAuth 콜백 `api/mail/oauth/callback`, 헬스 체크)을 명시 화이트리스트로.
  2. `proxy.ts`의 `isAuthConfigured()`(JWT_SECRET 있을 때만 검증하는 옵트인) 구조를 유지하되, **미설정 시 콘솔에 대형 경고**를 남기도록. 프로덕션(`NODE_ENV=production`)에서 미설정이면 뮤테이션 차단.
  3. 파괴적 route 4곳에 개별 서버측 가드 추가(심층 방어): `opportunities/[id]/route.ts`(DELETE), `mail-candidates/cleanup`, `mail-candidates/convert`, `settings/llm`(POST — LLM 자격증명 저장).
- **검증**: 미인증 curl로 DELETE/POST가 401/403인지, 로그인 세션으로 200인지. e2e smoke(Phase 0 산출물)로 기존 흐름 무파손 확인.
- **DoD**: 무인증 뮤테이션 0건. `pnpm build` 통과(미들웨어 추가가 빌드에 영향 없는지).

### S-2. apps/api 라우트 등록 순서 (P2)
- **현상**: `apps/api/src/index.ts:124` `/api/whelp99/tools/call`(임의 MCP 툴 실행)과 `:201` `/webhooks/outlook`이 `:163`의 auth 미들웨어보다 먼저 `app.use`됨.
- **작업**: whelp99 툴 호출을 auth 뒤로 이동(또는 전용 API 키 가드). webhook은 서명 검증(Outlook validation token) 추가 후 예외 유지.
- **검증**: 무인증 호출 401 확인 + 기존 webhook 흐름 회귀 테스트.

### S-3. tRPC CFO role 가드 (P3)
- **현상**: `apps/api/src/routers/cfo/*` 16개 서브라우터가 전부 `protectedProcedure`(로그인만). REST와 동일 데이터인데 role 가드 없음. `business.router.ts` 25개 프로시저도 role 가드 0.
- **작업**: `routers/trpc.ts`에 `financeProcedure = protectedProcedure.use(requireRole(FINANCE_ROLES))`를 신설하고 CFO 라우터 전체에 적용. `middleware/finance-access.ts:6-13`의 `FINANCE_ROLES`를 단일 소스로 재사용. business 라우터의 상업 뮤테이션(`createQuote`, `submitQuoteForApproval`, `completeDelivery`)에도 적절한 role 적용.
- **검증**: 비재무 role 세션으로 tRPC CFO 호출 시 FORBIDDEN.

### S-4. 세금계산서 민감 컬럼 (P4)
- **작업**: `routers/cfo/tax-invoices.router.ts:11-14` list에 REST(`routes/cfo.ts:157`)와 동일한 `omit: { rawXml, rawResponse }` 적용.
- **검증**: tRPC 응답에 두 필드 부재 단언 테스트 추가.

---

## Phase 0 — 안전망 구축 (`test:` 커밋만)

> 목적: 이후 모든 구조 변경의 그물. 프로덕션 코드는 건드리지 않는다. 브랜치 `refactor/phase-0-safety-net`.

### 0-1. Playwright e2e 복구 (P6)
- **현상**: `playwright.config.ts`가 `testDir: "./tests/playwright"`(부재)를 가리키고 `testMatch`의 spec 3개(`smoke`/`portal-full-functional`/`trace-verification`)는 존재하지 않음. 실존 spec 11개는 `tests/e2e/playwright/`에 있으나 하나도 실행 안 됨.
- **작업**:
  1. `testDir: "./tests/e2e/playwright"`로 수정, 죽은 `projects`/`testMatch` 제거.
  2. 11개 spec을 실행해 **현재 통과/실패 목록을 만들고**, 실패 spec은 스킵 마킹(`test.fixme`) + 사유 주석(stale인 `finance.spec.ts`는 Phase 1에서 삭제 예정 태깅). 통과분만 green 상태로 확정.
  3. 핵심 사용자 흐름 smoke 신규 작성: 로그인 → 포털 내비 → deals 목록/상세 → cfo 대시보드 → 메일 후보 목록. (Phase S의 인증 추가 후에도 통과하도록 세션 픽스처 포함.)
- **검증**: `pnpm test:e2e` green(스킵 제외). CI 편입은 Phase 8.

### 0-2. 고churn 무테스트 모듈 특성화 테스트 (P7)
- **대상과 최소 커버 시나리오**:
  - `packages/business/src/opportunity-center.ts`(343줄, churn 9): 목록/생성/스테이지 전이의 현재 동작 스냅샷. Prisma는 `domain-persistence.ts:38`의 `PersistencePrisma` 구조적 타입 주입 패턴을 본떠 fake 주입이 가능하게 **테스트 접근용 최소 seam만** 허용(그 외 프로덕션 변경 금지).
  - `packages/business/src/proposal-generator.ts`(235줄, churn 7): `buildVariables`(CCN 16) 입력→출력 골든 케이스, LLM 호출부는 fake generator 주입.
  - `packages/business/src/poc-center.ts`(292줄, churn 5): POC 생성 + opportunityId 자동 링크 특성화.
- `mail-candidates.ts`는 기존 460줄 테스트가 있으나 Phase 4 분해 전 **골든 마스터 보강**: 대표 메일 픽스처 20~30건에 대한 `classifyMailCandidateDocument`/`classifyMailInsightThread`/`combineHybridClassification` 출력 스냅샷(순수 함수 구간만; DB/AI는 제외).
- **DoD**: 신규 테스트 전부 `CI_INTEGRATION` 없이 기본 `pnpm test`에서 실행됨.

### 0-3. 커버리지 기준선 기록
- `pnpm test:coverage` 1회 실행, 결과를 `.agents/results/refactor/coverage-baseline-2026-07-02.md`로 저장(Phase별 회귀 비교 기준).

---

## Phase 1 — 데드코드/무해 삭제 (`chore:` 커밋)

> 목적: 이후 Phase의 작업 표면적 축소. 삭제는 전부 되돌리기 쉬우므로 리스크 최저·효율 최고. 브랜치 `refactor/phase-1-dead-code`. **각 삭제 전 반드시 역참조 grep 재확인**(감사 시점 이후 변동 가능).

### 1-1. 죽은 패키지 (P16)
| 대상 | 근거 | 작업 |
|---|---|---|
| `packages/cache`, `packages/proxy-core`, `packages/security`, `packages/ui` | 역참조 0건 | 디렉터리 삭제 + 루트/각 package.json 의존 정리. 주의: `proxy-core`가 auth/config/health를 의존하지만 그 셋은 다른 소비자가 있으므로 유지 |
| `@sangfor/application` | `apps/api/package.json` 선언만, import 0건 | `apps/api` 의존 선언 제거 → 패키지 삭제 |
- **검증**: `pnpm install && pnpm -r build && pnpm test`. `grep -r "@sangfor/(cache|proxy-core|security|ui|application)"` 0건.

### 1-2. web 데드 라우트/컴포넌트 (P17)
| 대상 | 근거 |
|---|---|
| `(portal)/approvals/[id]/page.tsx` 621줄 | id 무시, 신한은행 하드코딩 데모만 렌더. **삭제 전 사용자 확인 불필요** — 실데이터 상세는 `approvals/page.tsx` 흐름에 없음이 확인됨. 삭제 후 목록에서 상세 링크 제거 or "준비 중" 처리 |
| `(portal)/approval/page.tsx`(redirect 별칭), `(portal)/blocks/`, `(portal)/color-agents/`(내비는 `/agents`), `(portal)/portal/`(구 MVP), `(portal)/finance/`(구 대시보드, 내비는 `/cfo/dashboard`), `(portal)/validation/` | 내비 미등재 + 인바운드 링크 0 |
| `src/components/dashboard/redesigned-dashboard.tsx` 462줄 | 참조 0 |
| `module-dashboard-client.tsx`의 `MOCK_VAL_LOGS`(L164), `dashboard/page.tsx:13`의 console.log 스텁 | 목 잔재 |
- **검증**: `pnpm build`(라우트 테이블에서 소멸 확인) + e2e 내비 spec 통과.

### 1-3. apps/api 데드코드 (P12 일부)
- `apps/api/src/context.ts`: `createTRPCContext` 호출 0건, `context/index.ts`와 verbatim 중복. **`Context` 인터페이스 export만 살아있는지 확인** 후: 타입은 `context/index.ts`로 이동, 파일 삭제.
- `apps/api/src/routers/mail.router.ts`의 인메모리 `mailStore`(L25): 데모 잔재 — 소비처 확인 후 삭제 또는 실데이터 위임으로 교체는 Phase 6으로 이월(여기서는 건드리지 않음).

### 1-4. 스크립트/유령 포트/VCS 위생 (P22, P23)
- `scripts/`: 일회성 확정분 삭제 — `dispatch-opencode-phase5/6/7*.ts`, `dispatch-opencode-fix-directive.ts`, `dispatch-cursor-agent.ts`, `continue-collaboration-queue.ts`, `run-collaboration-contract.ts`, `apply-aios-v1-0-2-full-impl.sh`(56KB), 중복쌍 중 1벌(`start-integration-stack.sh` vs `.mjs`, `daily-report.sh` vs `.py`). 각각 `git log -1 -- <path>`로 최근 사용 여부 확인 후 삭제.
- 유령 포트 4100: `scripts/mock-upstreams.mjs`의 CFO AIOS mock, `scripts/start-integration-stack.mjs`의 `freePort(4100)` 제거.
- VCS: 추적된 `.omo/` 6파일 `git rm --cached`(이미 gitignore), `.superpowers/` 2파일·`memory/agent-handoffs` 처리 방침은 사용자 확인(§11-D). `cypress.config.ts` + cypress devDep + 루트 `tsconfig.json`의 `include: ["cypress/**/*"]` 제거(죽은 툴체인 — 단 `packages/ui` 삭제(1-1)와 함께 tsconfig 상속 오구성도 자연 해소됨).
- stale 워크트리: `.worktrees/ax-overhaul`(2일 정체) — 브랜치 미머지 커밋 확인 후 `git worktree remove`(사용자 확인 §11-D).
- **검증**: `make up`/`make status` 정상(스택 스크립트 파손 여부), CI green.

### 1-5. 문서 드리프트 마킹
- `packages/finance` 잔존 참조 6곳(`docs/reports/*` 등)에 헤더로 `> ⚠️ HISTORICAL — packages/finance는 제거됨(:3200/api/cfo가 단일 소스)` 삽입. 날짜 박힌 worklog는 삭제하지 않는다(이력 가치).

---

## Phase 2 — 중복 통합 (`refactor:` 커밋)

> 목적: "같은 지식이 한 곳에". 브랜치 `refactor/phase-2-dedup`. 각 항목 = 독립 커밋.

### 2-1. 통화 포맷터 단일화 (P12)
- **현상**: `krw`(`apps/web/src/lib/cfo-theme.ts:14`), `formatKRW/formatKRWCompact`(`components/deals/stage-meta`), `won`(`cfo/invoices/page.tsx:27`, `projects/[id]/page.tsx:10`), `wonE`(`cfo/expenses/page.tsx:51`), `wonC`(`cfo/cashflows/page.tsx:48`), 인라인 리터럴(`tax-invoices/page.tsx:9`) — 7~8벌.
- **작업**: `packages/shared/src/format.ts` 신설(`formatKRW`, `formatKRWCompact`, tabular 옵션) → 전 사용처 치환 → 구현체 삭제. 출력 문자열이 바뀌지 않도록 각 기존 함수의 현재 출력을 테스트로 고정한 뒤 치환.

### 2-2. 메일 도메인 상수/정규화 단일화 (P12)
- **현상**: 자사 도메인 리스트 3벌(`mail-candidates.ts:159-172` / `mail-entity-quality.ts:11-18` / `mail-policy-memory.ts:68-124` — 심지어 구성이 서로 다름: `berlo.co.kr`는 한 곳에만), 프리메일 리스트가 `mail-candidates.ts` 내부에서도 2회 복붙(L358, L517), 한국어 회사명 맵 2벌, `tech.support@sangfor.com` 판별 4회, `email.split("@")[1].toLowerCase()` 인라인 8곳.
- **작업**: `packages/business/src/mail-domain-registry.ts` 신설 — `SELF_DOMAINS`/`FREE_MAIL_DOMAINS`/`KNOWN_PARTNER_DOMAINS`/`KNOWN_DOMAIN_MAP`/`VENDOR_SAAS_DOMAINS` + `normalizeEmailDomain()`/`domainRoot()`/`isSelfDomain()`/`isVendorSupportSender()`. **주의**: 3벌 리스트의 합집합/차이를 표로 만들어 사용자 확인 후 병합(§11-E) — 리스트 차이가 의도인지 드리프트인지 코드만으로 판단 불가.
- **검증**: 0-2의 메일 분류 골든 마스터 스냅샷 무변화.

### 2-3. `sanitizeJsonStrings` 단일화 (P12)
- `mail-candidates.ts:296`과 `domain-proposal.ts:18`의 두 구현을 diff → 동일하면 `packages/shared`로 승격, 다르면 차이를 테스트로 고정 후 상위집합으로 병합. `langfuse-observability.ts:66`의 `sanitizeUnknown`은 목적 다르면 유지.

### 2-4. Outlook 동기화 단일화 (P12) — **이 Phase 최대 항목**
- **현상**: `apps/web/src/lib/outlook-graph.ts`(500줄, 위임형 OAuth+Graph+홈택스 스캔+캘린더) vs `packages/business/src/outlook-sync.ts`(app-only client_credentials). `apps/web/src/app/api/mail-import/route.ts:2-31`이 둘을 import해 분기.
- **작업**(원자 단계):
  1. `packages/business/src/outlook/` 디렉터리 신설, `outlook-graph.ts`를 web lib → business로 **이동만**(로직 무변경, import 경로 치환). web lib에는 re-export 셔임 잔류.
  2. 공통 Graph fetch/토큰 헬퍼 추출(위임형·app-only가 공유).
  3. `mail-import/route.ts`의 분기 로직을 business의 `syncOutlook({ preferDelegated: true })` 단일 진입점으로 이관, route는 얇은 어댑터화.
  4. web lib 셔임 제거.
- **주의**: `sanitizeText`(`outlook-graph.ts:176`)를 `mail-learning.ts:16`이 사용 — 이동 시 함께 치환. OAuth 콜백 URL 상수(`outlook-graph.ts:23` `http://localhost:3101/...`)는 이 기회에 env 기반으로 정리하되 기본값 동일 유지.
- **검증**: `CI_INTEGRATION=1` 메일 테스트 + 실제 `POST /api/mail-import` 동작 확인(위임형 계정 연결 상태에서).

### 2-5. LLM 설정 단일화 (P10)
- **현상**: 해석 지점 5곳, 기본 모델 상충(`OPENAI_MODEL` 기본 `gpt-4o-mini` in `openai-config.ts:51` vs `OPENCODE_MODEL` 기본 `gpt-5` in `domain-llm.ts:21`), `llm-settings.ts:59-78`이 DB값을 `process.env`에 덮어쓰는 mutate로 동기 getter들과 숨은 결합.
- **작업**(행위 보존 경계 주의 — env mutate 제거는 행위 변경이 될 수 있으므로 아래 순서 엄수):
  1. `packages/business/src/llm/config.ts` 신설 — `resolveLlmConfig(): { apiKey, baseUrl, model, source }` 단일 함수. 우선순위(웹 저장값 > env)와 MiMo/`sk-`/`tp-` prefix 자동 매핑 로직을 그대로 흡수. **두 스택(OpenAI 호환 / opencode)은 각각의 resolver로 유지하되 한 파일에 병치** — 통합이 아니라 "한 곳에서 보이게".
  2. 6곳의 chat/completions 호출부(`mail-candidates`, `domain-proposal`, `automation-preview`, `domain-embedder-openai`, `skills/skill-runner`, `openai-config`)가 새 resolver를 쓰도록 치환.
  3. `process.env` mutate는 **일단 유지**(제거는 별도 결정 §11-F — hydration 계약을 바꾸면 행위 변경).
- **검증**: LLM 키 설정/미설정 각각에서 `mail-learn` 흐름과 도메인 파이프라인 stub 폴백 동작 무변화.

### 2-6. 대시보드 로직 중복 (P8 부분 — 복붙 제거만)
- `apps/web/src/app/api/dashboard/[role]/route.ts`의 8개 role 함수와 `apps/api/src/routers/dashboard.router.ts`의 복붙(매직넘버 50000, 가중치 맵 동일)을 `packages/business/src/role-dashboard.ts`(신설)로 추출, 양쪽이 호출. 표면 자체의 통폐합은 Phase 6.

---

## Phase 3 — 레이어 정리: web route → business (`refactor:`)

> 목적: route.ts는 "인증 + 파싱 + business 호출 + 직렬화"만. 브랜치 `refactor/phase-3-layering`.

### 3-1. prisma 직접 사용 11개 route 이관 (P11)
대상: `actions/[actionKey]/validate`, `daily-report`, `dashboard/[role]`(2-6에서 처리), `domain-pipeline`(+`stream`), `mail-candidates/batch`, `mail-candidates/cleanup`, `mail-candidates/convert`, `mail-insight-threads/generate`, `modules/[moduleKey]/validate`, `policy-memories/[id]`.

각 route당 커밋 1개, 패턴 동일:
1. route 내 로직을 business의 기존 모듈(있으면) 또는 신규 함수로 추출 — 예: `convert/route.ts`(196줄)의 오케스트레이션은 `mail-candidates.ts`의 기존 `approveMailDerivedCandidate`/`convert*` 계열과 통합(중복 확인 필수 — business에 이미 유사 함수 존재).
2. route는 추출 함수 호출로 축소.
3. **`cleanup/route.ts`의 nexias 하드코딩 특례(L28-48)**: 로직 이동만 하고, 하드코딩 제거는 §11-E(도메인 레지스트리 데이터화)와 연동.
- **검증**: 각 route에 대해 이관 전 request/response 캡처 → 이관 후 동일성 확인(수동 or supertest).

### 3-2. `"demo-project"` 하드코딩 18곳 (P18)
- `apps/web/src/lib/scope.ts` 신설: `resolveProjectScope()` — 현재는 `"demo-project"`를 반환하는 **단일 상수 소스**로 시작(행위 동일). 18곳 전부 치환. 실제 멀티테넌시 도입은 리팩토링 범위 밖(기능 개발)임을 명시.
- 함께: `portal-config.ts:86`의 `MOCK_USER`도 `scope.ts` 경유로 단일화(제거는 인증 기능 개발 시).

### 3-3. apps/api REST CFO 정리 (P25)
- `routes/cfo.ts`의 `ok()` 래퍼가 모든 예외를 400 + `e.message`로 뭉개는 문제: `AppError` 매핑(`middleware/error-handler.ts`)에 위임하도록 래퍼 수정 — **단, 상태코드 변화는 행위 변경이므로**: 1단계(refactor)는 `req/res any` 제거·핸들러 타입화·zod 스키마 추가(파싱 실패 시 기존과 같은 400 유지), 2단계(fix, 별도 커밋)로 404/403/500 구분 도입.
- `services/finance/*.service.ts`의 `where: any` 등 127건: Prisma 생성 타입(`Prisma.CashflowWhereInput` 등)으로 치환. 파일당 1커밋.
- 조용한 `catch {}` 6곳(`company-settings.router.ts:19`, `events.ts:34,61,80,109`, `tax-invoice-mail-scan.service.ts:35`): 최소한 구조화 로그 추가(행위 보존 — 삼키는 동작 자체는 유지, 개선은 별도 fix).

---

## Phase 4 — God-file 분해 (`refactor:`)

> 목적: 최대 핫스팟 해체. **반드시 Phase 0의 골든 마스터가 green인 상태에서 시작.** 브랜치 `refactor/phase-4-god-files`.

### 4-1. `mail-candidates.ts` 2,260줄 분해 (P5) — 최우선
현 구조(단일 파일): 상수/블록리스트 + 순수 분류 + AI 분류 + 하이브리드 결합 + DB 부수효과 + 엔티티 변환 + 정책 메모리.

**목표 구조** (`packages/business/src/mail/` — Phase 5의 패키지 재편과 정합):
```
mail/
  constants.ts            ← 2-2의 mail-domain-registry와 통합
  parse.ts                ← parseMailHeader(632줄 함수!), domainFromEmail 계열
  classify-rules.ts       ← classifyMailCandidateDocument, classifyMailInsightThread (순수)
  classify-ai.ts          ← classifyWithAI, combineHybridClassification
  candidates-generate.ts  ← generateMailDerivedCandidates, suppressPolicyExcludedCandidates (DB)
  candidates-approve.ts   ← approveMailDerivedCandidate, convert* 계열, reinforcePolicyMemory… (DB)
  index.ts                ← 기존 공개 심볼 재수출(호환 유지)
```
**원자 단계**(각각 커밋, 각 단계 후 골든 마스터+유닛 재실행):
1. 상수 추출(2-2와 병합) → 2. 순수 파서 추출 → 3. 순수 분류 추출 → 4. AI 분류 추출 → 5. DB 부수효과 2파일 추출 → 6. 원본 파일을 재수출 셔임으로 축소 → 7. 소비처 import 직접 경로로 전환 후 셔임 제거.
- **고복잡도 함수 내부 정리**(추출 후 별도 커밋): `candidateLooksPolicyExcluded`(CCN 39), `resolveThreadEntityPolicy`(CCN 36), `titleBracketName`(CCN 32) — 조기 반환/룩업 테이블화. lizard로 CCN < 15 확인.
- **주의**: lizard가 잡은 `domainFromEmail@191-1486`/`parseMailHeader@316-947` 같은 거대 스팬은 중첩 함수 정황 — 분해 시 중첩 클로저를 최상위 순수 함수로 승격.

### 4-2. `domain-persistence.ts` 익명 함수 CCN 56
- L79-227의 149줄 익명 함수를 도메인별(`persistOpportunity`/`persistQuote`/`persistInvoice`…) named 함수로 분리. 기존 테스트(`domain-persistence.test.ts`) 유지 통과.

### 4-3. web God 컴포넌트 (P19)
- `module-dashboard-client.tsx`(1,489줄): ① DB 타입 재정의 6종(L31-84)을 `@sangfor/db` 타입 import로 교체 ② 매핑 테이블 3종(L101,123,157)을 `lib/module-mappings.ts`로 ③ 검증/커넥터 테스트 로직을 훅(`useModuleValidation`)으로 ④ 섹션별 컴포넌트 분리. 렌더 스냅샷 테스트 선행.
- `cfo/(cfo)/tax-invoices/page.tsx`(743줄): 내장 컴포넌트 5종(`StatusBadge`/`TaxTable`/`PurchaseSection`/`SalesSection`/`SectionRule`)을 `components/cfo/tax-invoices/`로, fetch 4곳을 데이터 훅으로. 통화 포맷터는 2-1 산출물 사용.
- `deals/[id]/page.tsx`(447줄): business 함수 11종 fetch를 `getDealWorkspace(id)` 단일 조회 함수(business에 신설)로 응집.
- `approvals/[id]`는 Phase 1에서 삭제됨. `phase14/context-pack-builder.ts`(CCN 44)·`skills/phase13-orchestrator.ts`(CCN 27)는 Phase 5 재편 시 함께 분해.

---

## Phase 5 — `@sangfor/business` 패키지 경계 재편 (P9)

> **전제**: Phase 4 완료(mail/ 서브디렉터리가 이미 존재). 브랜치 `refactor/phase-5-package-boundaries`.
> **강도 선택**: A안(디렉터리 재편, 패키지 유지 — 권장) vs B안(물리 패키지 분리). **A안으로 진행**하고 B는 후속 판단 — B는 pnpm 그래프/버전/CI 전면 변경이라 리스크 대비 이득이 지금은 작다.

### 5-1. 디렉터리 재편 (A안)
```
packages/business/src/
  mail/        ← Phase 4-1 산출 + mail-entity-quality, mail-policy-memory, mail-insight-threads,
                 mail-candidate-connections, ai-classify-batch(이름 오도 — 실제는 backoff/mapPool 유틸이므로
                 mapPool은 shared로, GROUND_TRUTH는 mail/로), outlook/(2-4 산출)
  domain-ai/   ← domain-* 19개 파일 + opencode-client, opencode-structured
  crm/         ← opportunity-center, engagement-center, customer-partner, poc-center, meeting-promotion,
                 deal-*, quote-engine, proposal-generator
  finance/     ← executive-dashboard, commercial-approval, revenue-core, asset-renewal, domain-pnl
  governance/  ← approval-*, audit-*, ai-quality-gate, validation-engine
  orchestration/ ← action-connector-runtime, automation-preview, module-*, command-center,
                   workflow-runner, codex/cursor/github 커넥터, dev-engine, skills/(구 phase13), context-pack/(구 phase14)
  platform/    ← llm/(2-5 산출), openai-config, llm-settings, observability, langfuse, notification,
                 task-center, knowledge-search, map-with-concurrency
```
- **`phase11~14` 네이밍 전폐**: `skills/phase13-*` → `orchestration/skills/assignment-rules.ts` 등 도메인 이름으로. 테스트 파일명도 동일(`phase12-*.test.ts` → 해당 도메인 테스트로 이름 변경만, 내용 불변).
- 이동은 `git mv` + import 경로 일괄 치환(codemod/IDE 사용). 디렉터리당 1커밋.

### 5-2. 배럴/진입점 정리
- `src/index.ts`의 `export *` 74건을 **명시적 named export**로 전환(1커밋), 이후 서브디렉터리별 `index.ts`로 위임. package.json 서브패스 17개는 새 디렉터리 구조에 맞춰 재정렬(`./mail-candidates` 등 기존 경로는 당분간 alias 유지 → 소비처 전환 후 제거).
- 순환 의존 해소: `domain-agent-runtime` ↔ `domain-default-generator`/`domain-persistence` 사이클은 공용 타입(`DomainGenerator`, `DomainArtifact`)을 `domain-ai/types.ts`로 추출해 절단.

### 5-3. 위성 패키지 흡수 결정 반영 (§11-G)
- `@sangfor/persona`(1파일, api에서 동적 import 1건)와 `@sangfor/mail-intelligence`(web 어댑터 1건)의 메일 분류 로직이 `mail/`와 중복인지 대조 → 사용자 결정에 따라 `mail/`로 흡수 or 유지.

### 5-4. Prisma 결합 완화(점진, 선택)
- 신규/이동 파일부터 `domain-persistence.ts:38`의 구조적 타입 주입 패턴을 표준으로 채택(문서화: `packages/business/CONVENTIONS.md`). 기존 43개 파일 일괄 전환은 **하지 않는다**(비용 대비 이득 낮음) — 새로 만지는 파일만 전환하는 보이스카우트 규칙.

---

## Phase 6 — API 표면 단일화 (P8) — **ADR 선행 필수**

> 현상: ① web REST 92 route(자체 구현) ② apps/api tRPC 124 프로시저(web이 소비 안 함) ③ apps/api REST 83(finance는 web이 프록시로 소비). 같은 도메인(customers/opportunities/poc/dashboard/mail)이 2~3중 구현.

**권장안(ADR 초안)**: "web = BFF" 원칙.
- CRM/대시보드/메일 = **web route → `@sangfor/business` 직접 호출**(현 주류 패턴)로 통일. apps/api의 `business.router.ts`(304줄 인라인 prisma)·`dashboard.router.ts`·`mail.router.ts`(인메모리 목)는 **web 미소비 확인 후 제거**.
- finance/CFO = **apps/api 소관 유지**(REST 단일화). tRPC CFO 16개 서브라우터와 REST 71개 중 **소비자가 실제 사용하는 쪽만 남김** — 실측: web은 REST 프록시(`api/finance/[...path]`)만 사용하므로 tRPC CFO는 외부 소비자 부재 시 제거. **제거 전 apps/web 외 소비자(모바일/스크립트) 부재를 grep+로그로 확인.**
- 산출물: `docs/plans/adr-001-api-surface.md` 작성 → 사용자 승인 → 실행. 실행은 라우터 단위 커밋, 각 제거 전 접근 로그/grep 증거 첨부.

---

## Phase 7 — DB 스키마 정리 (P13·14·15·24) — **expand-contract, 결정 게이트**

> 모든 변경은 정식 마이그레이션. 실데이터 보유 DB. 순서: 무해(additive) → 구조(계약 변경).

### 7-1. 즉시 가능(additive, 무해)
1. **인덱스 추가**: `Cashflow`(type, projectId, date), `Invoice`(depositStatus, projectId), `Expense`(category, isPaid, projectId), `TaxInvoice`(direction, issueDate). 마이그레이션 1개. *성능 리팩토링이 아니라 실쿼리(`cashflows.service.ts:65-74`, `cfo.ts:152-154`)가 이미 밟는 경로의 결손 보수.*
2. **raw SQL 이중 정의 해소(P15)**: `prisma/sql/domain_axis_tables.sql`이 정식 마이그레이션 `20260629110000_…`과 동일 테이블 정의 — 실 DB에 마이그레이션 적용 이력 확인 후 sql 파일에 `-- SUPERSEDED by migration 20260629110000` 헤더 추가 or 삭제. `domain_axis_embedding.sql`(pgvector, 어떤 마이그레이션도 미참조)은 정식 마이그레이션으로 승격.
3. **스냅샷 커버리지(P24)**: `cfo-snapshot.ts:21-26`의 4테이블 → CFO 도메인 전체(`taxInvoice, financeSubscription, ledgerEntry, monthClose, financeAccount, companySettings` 추가). 장기적으로 `pg_dump` cron(백로그 기존 항목)과 병행.

### 7-2. 관계 승격(expand-contract 1단계 = expand만)
- `Invoice.engagementId`/`Expense.engagementId`/`TaxInvoice.engagementId·projectId·expenseId`에 `@relation` 추가(FK). **기존 데이터의 고아 ID를 사전 검증하는 스크립트 먼저**(`SELECT ... LEFT JOIN ... WHERE b.id IS NULL`) — 고아 존재 시 관계 추가는 보류하고 결과를 보고.

### 7-3. 개념 통폐합(§11-H 결정 후, 장기)
- project 4중(P13)·invoice 2중·금액 Int/Decimal 혼재·`project_id`=company id 의미 드리프트는 **이번 사이클에서 실행하지 않는다**. 대신: ① 현황 매핑 문서(`docs/plans/schema-concept-map.md` — 어떤 코드가 어떤 모델을 왜 쓰는지) 작성 ② 신규 코드가 어느 모델을 써야 하는지 규칙 명문화(schema.prisma 주석 + CONVENTIONS.md). 통폐합은 별도 프로젝트로.

---

## Phase 8 — 툴링/워크스페이스/CI 표준화 (P20·21) — 독립 병렬 트랙

1. **버전 통일**(`chore:` 커밋 각각): TypeScript `^5.9.3`(현 최다+최신), vitest `^3.2.4`(v4는 engineer-mcp만 — 루트 워크스페이스 먼저, services는 별도), packageManager `pnpm@10.28.1`, Node: `.nvmrc`=20 유지하되 `cd.yml`의 22를 20으로(또는 전체 22 승격 — CI에서 20이 검증 중이므로 20 통일이 안전).
2. **tsconfig 일원화**: `tsconfig.base.json`의 `noEmit`/`declaration` 모순 해소(베이스는 노출 옵션만, emit은 각 패키지) → 전 패키지 base 상속(현 3/16).
3. **CI 최적화**: `ci.yml`의 lint/typecheck/test/build 4개 job이 각자 `pnpm build`(web 포함) 실행 → build job만 빌드하고 나머지는 필요한 패키지 빌드로 축소(`--filter`), 또는 아티팩트/캐시 공유. `pnpm test:coverage`를 test job에 편입 + 커버리지 요약을 PR 코멘트/아티팩트로. Phase 0의 e2e를 별도 job으로 추가(playwright, 앱 기동 포함). `cd.yml` 가짜 배포는 삭제 or `workflow_dispatch`로 강등.
4. **services 전략(§11-I 결정 필요)**: `services/sangfor-mcp-workflow`의 크로스-서비스 `file:` 의존(`@sangfor/chrome` → `../sangfor-engineer-mcp/...`)이 워크스페이스 편입·컨테이너화·CI 검증을 모두 막는 근원. 권장: `sangfor-chrome`을 루트 워크스페이스 패키지로 승격 → 두 서비스 모두 workspace 의존으로 전환 → services를 루트 `pnpm-workspace.yaml`에 편입 → CI 커버. (대안: 현상 유지 + services 전용 CI job.)
5. **env 문서화**: 루트 `.env.example`(3.1KB)이 실사용(고유 env ~561개 상한 추정)을 못 덮음 → 앱/패키지별 `.env.example` 신설(web·api·business 최소 3개), `docs/DEV_REFERENCE.md` §5에 링크.

---

## 11. 사용자 결정 필요 목록 (실행 모델이 임의 판단 금지)

| ID | 질문 | 기본 권장 |
|---|---|---|
| D | 추적된 `.superpowers/`·`memory/agent-handoffs` 파일 및 stale 워크트리(`ax-overhaul`) 처리 | gitignore + 언트래킹, 워크트리는 미머지 커밋 백업 후 remove |
| E | 자사/파트너 도메인 리스트 3벌의 차이(예: `berlo.co.kr`, nexias 특례)가 의도인지 — 병합 기준 확정 | 합집합 표를 만들어 사용자 검수 |
| F | `llm-settings.ts`의 `process.env` mutate 계약 제거 여부(행위 변경) | 이번 사이클 유지, 차기에 명시적 config 객체로 |
| G | `persona`/`mail-intelligence` 패키지를 `business/mail`로 흡수? | 중복 대조 후 흡수 권장 |
| H | 스키마 개념 통폐합(project 4중 등) 착수 시점 | 이번 사이클 제외, 매핑 문서만 |
| I | services 워크스페이스 편입(8-4) | 편입 권장 |
| J | **popbill 경로 존치 여부** — 문서(§3.H)는 "팝빌 없음"인데 `popbill.service.ts`(196줄, 테스트 0)+라우터가 등록·노출됨. 교체형 어댑터 의도라면 유지, 아니면 제거 | 국세청 전송 어댑터로 유지하되 feature flag 뒤로 |
| K | API 표면 ADR(Phase 6) 승인 | web=BFF, tRPC business/dashboard/mail 제거, CFO는 REST 단일화 |

---

## 12. 성공 지표 (Phase별 전/후 측정)

- **복잡도**: `uvx lizard -l typescript --CCN 15 packages/business/src apps/api/src apps/web/src/lib apps/web/src/app/api` — 경고 21건 → **5건 이하**, 최대 파일 2,260줄 → **500줄 이하**.
- **중복**: 통화 포맷터 1벌, 메일 도메인 상수 1벌, Outlook 동기화 1벌, 대시보드 role 로직 1벌.
- **테스트**: 기본 `pnpm test`(비통합)로 검증되는 고churn 모듈 0→3개(opportunity/proposal/poc), e2e 실행 가능 spec 0→11(스킵 제외), 커버리지 기준선 대비 비감소.
- **표면**: 무인증 뮤테이션 61→0, API 중복 도메인 5→0(Phase 6 후), 죽은 패키지 5→0, 데드 라우트 6→0.
- **게이트**: 모든 Phase에서 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` + `CI_INTEGRATION=1 pnpm test` green 유지.
- 각 Phase 종료 시 `.agents/results/refactor/phase-<n>-report.md`에 전/후 메트릭과 이월 항목 기록, `docs/DEV_REFERENCE.md` 변경 이력 1줄 추가.

---

## 부록 A. 감사 증거 원본 위치

- 정량: lizard CCN 경고 21건 목록, churn 상위 40파일, LOC/테스트 비율 — 본 문서 §1 표에 인라인.
- web/business/api·db/위생 4개 영역 상세 감사는 2026-07-02 세션에서 수행(파일:라인 근거는 각 Phase 표에 반영). 라인 번호는 실행 시점에 재검증할 것.
