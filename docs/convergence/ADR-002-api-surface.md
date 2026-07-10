# ADR-002 — API Surface Unification (web = BFF)

- **Status:** Accepted (2026-07-10 사용자 승인)
- **Date:** 2026-07-10
- **Branch:** `dev-clean` (HEAD `738f525`, origin/main 동기)
- **Deciders:** M1 W2~W4 execution (roadmap 08 §3 Task 0)
- **Supersedes:** `docs/superpowers/plans/2026-07-03-phase-6-api-unification.md`의 tRPC 도입 방향(해당 문서 상단 배너 참조). 마스터플랜(`docs/plans/2026-07-02-problem-based-refactoring-plan.md`) Phase 6·7 방향을 재확정.

---

## Context

두 정본 문서가 같은 Phase에 대해 정반대 방향을 갖고 있어(00-INDEX §5 상충 2건), 어느 쪽도 실행할 수 없는 상태였다. M4(플랫폼 통합)가 이 결정에 의존한다.

### 상충 1 — Phase 6 방향
- **마스터플랜** (2026-07-02): "web = BFF" — CRM/대시보드/메일은 web route → `@sangfor/business` 직접 호출로 통일, **실호출자 없는 tRPC 표면 제거**, finance/CFO는 apps/api REST 단일화.
- **phase-6 실행 문서** (2026-07-03): 정반대 — "(2) **tRPC를 도입**하여 type-safe RPC 제공 (3) OpenAPI 스펙 자동 생성".

### 상충 2 — Phase 7 내용
- **마스터플랜**: 인덱스 보수 + FK 승격(additive, expand-contract), 개념 통폐합은 명시적 제외.
- **phase-6 문서 내장 Phase 7**: 신규 컬럼 `segment`/`riskScore` 추가.

### 실측 (2026-07-10, this decision's evidence base)
- **web REST**: `find apps/web/src/app/api -name route.ts | wc -l` = **97개** (마스터플랜 당시 92, 로드맵 표기 ~95 — 계속 증가 중인 주류 패턴).
- **web tRPC = 죽은 스텁**: 6개 파일(`api/trpc/[trpc]/route.ts`, `api/_lib/trpc-server.ts`, `api/openapi.json/route.ts`, `trpc/{index,openapi,hello}.ts`). `appRouter`는 `hello` 라우터 하나뿐이고 주석 "remaining routers will be added in later tasks"는 실행된 적 없음. **`.tsx` 소비자 0개.**
- **openapi.json도 스텁 종속**: `trpc-to-openapi`의 `generateOpenApiDocument(appRouter)`로 생성 — 현재 문서화하는 것은 hello 엔드포인트 하나.
- **apps/api tRPC**: 최상위 라우터 7개 + `routers/cfo/` 16개 서브라우터, `/trpc`에 마운트. 그러나 **저장소 전체에 tRPC 클라이언트 import 0개**(`createTRPCProxyClient|createTRPCClient|@trpc/client` grep 0건). web은 apps/api를 REST 프록시(`api/finance/[...path]` → `:3200/api/cfo`)로만 소비.
- **상충 2는 이미 절반 소화됨**: `Customer.segment`/`riskScore` 컬럼은 2026-07-03에 이미 추가됨(schema.prisma:655-656, nullable+default+`@@index([segment, riskScore])`). 마스터플랜 Phase 7-1의 인덱스(Cashflow/Invoice/Expense/TaxInvoice)는 **아직 없음**(grep 확인).
- phase-6 문서의 (1)응답 포맷 정규화는 부분 실행됨(`api/_lib/api-response.ts` + 테스트 존재) — tRPC와 무관하게 유효.

---

## Decision

### D1 — web = BFF를 채택한다. web tRPC 스텁은 제거 대상이다 (실행 = M4)
CRM/대시보드/메일의 유일한 패턴은 **web route handler → `@sangfor/business` 직접 호출**(현재 97 route가 이미 이 패턴). web의 tRPC 6파일은 hello 스텁 이상으로 자란 적이 없고 소비자가 0이므로, 확장이 아니라 **제거**한다. 근거: P8(API 표면 3중화)의 목적은 표면 **축소**인데 tRPC 도입은 세 번째 표면을 추가한다. type-safety는 route→business 직접 호출에서 TypeScript가 이미 제공한다.

### D2 — OpenAPI 문서화는 유지하되, tRPC 없이 달성한다
`openapi.json` route는 유지하되 소스를 tRPC 스텁이 아닌 REST 표면 기반 스펙으로 교체한다(06 문서의 기존 `openapi.json` 라우트 확장 방향). `trpc-to-openapi` 의존성은 스텁과 함께 제거. **스텁 제거와 openapi.json 교체는 같은 커밋으로** — 중간 상태에서 라우트가 깨지지 않게.

### D3 — finance/CFO는 apps/api REST 단일화. apps/api tRPC는 소비자 부재 증명 후 제거 (실행 = M4)
apps/api의 REST(`/api/cfo/*`)가 web 프록시의 유일한 소비 경로다. tRPC 표면(7+16 라우터, in-repo 클라이언트 0)은 마스터플랜 지시대로 **제거 전 외부 소비자(모바일/스크립트/curl) 부재를 접근 로그 + grep으로 확인**하고, 라우터 단위 커밋으로 제거한다. 이 ADR은 방향 결정이며 제거 실행은 M4 소관 — 지금 코드를 건드리지 않는다.

### D4 — Phase 7 범위 = 마스터플랜 방향(인덱스 보수 + FK 승격, additive only)
- 이미 추가된 `segment`/`riskScore`는 **기정사실로 수용**(nullable+default라 무해, 롤백은 파괴적 마이그레이션이라 이득 없음). 단, **추가 예측성 컬럼은 5차 고도화(07 문서) 전까지 금지**.
- M4에서 실행할 잔여 범위: 마스터플랜 7-1 인덱스(Cashflow `type,projectId,date` / Invoice `depositStatus,projectId` / Expense `category,isPaid,projectId` / TaxInvoice `direction,issueDate`) + 7-2 FK 승격(`Invoice/Expense/TaxInvoice.engagementId` 등 — **고아 ID 사전 검증 스크립트 선행**, 고아 존재 시 보류·보고).
- 개념 통폐합(project 4중 등)은 이번 사이클 제외 유지(마스터플랜 7-3 그대로).

---

## Alternatives considered (design-twice)

| Option | Description | Why rejected |
|---|---|---|
| **A. tRPC 도입** (phase-6 문서 원안) | web에 tRPC 라우터를 본격 구축, OpenAPI 자동생성 | 소비자 0인 표면을 늘림 — P8의 문제(같은 도메인 2~3중 구현)를 3중→유지가 아니라 심화. auth 재배선 비용. OpenAPI는 tRPC 없이 달성 가능 |
| **B. 전면 tRPC 이행** (REST 97개 → tRPC) | 단일 type-safe 표면으로 완전 이행 | 97 route 마이그레이션 + e2e/프록시 재작업 비용이 이득(이미 TS로 type-safe한 내부 호출) 대비 과다. 요구하는 소비자 없음 |
| **C. 현상 유지** (양 표면 공존) | 아무것도 안 건드림 | 죽은 표면은 부패하고, 에이전트·문서가 잘못 학습함(phase-6 문서가 정확히 그 사고) — P8이 지목한 문제 그 자체 |
| **D. apps/api tRPC 즉시 제거** (이번 패스) | 결정과 실행을 한 번에 | 접근 로그 기반 외부 소비자 부재 증명이 선행돼야 함(마스터플랜 명시). ADR은 결정 문서 — 실행은 M4의 라우터 단위 커밋으로 |
| **E. segment/riskScore 롤백** | 상충 2를 "마스터 순수 방향"으로 원복 | 이미 라이브(default 채워짐, 인덱스 존재). 롤백 = 파괴적 마이그레이션 금지 원칙 위반, 이득 0 |

---

## Consequences (ATAM-style)

### Positive
- M4 "API 표면 통일"이 모호한 방향 논쟁 없이 실행 가능한 체크리스트가 된다(D1~D4가 커밋 단위로 분해됨).
- 에이전트/신규 기여자가 배울 패턴이 하나로 수렴: route = auth + parse + business 호출 + serialize.
- 표면 지표(마스터플랜 §측정: "API 중복 도메인 5→0")가 달성 가능해진다.

### Negative / risks
| Risk | Sensitivity | Mitigation |
|---|---|---|
| R1 `/trpc`의 미확인 외부 소비자(모바일/스크립트) | MED | D3의 선행 증명(접근 로그 + grep) 없이는 제거 금지. 제거 후 1주기 410 응답 유지도 옵션 |
| R2 스텁 제거 시 `openapi.json` 라우트 파손 | LOW | D2: 같은 커밋에서 교체, e2e가 라우트 응답 확인 |
| R3 phase-6 문서의 유효 부분(응답 포맷)까지 폐기로 오독 | LOW | 배너 문구에 "tRPC 방향만 폐기, 응답 포맷 정규화는 유효" 명시 |
| R4 FK 승격 시 고아 ID로 마이그레이션 실패 | MED | D4: 고아 검증 스크립트 선행, 고아 존재 시 관계 추가 보류 |

### Follow-up (이 ADR이 설정하는 M4 실행 항목, 여기서 실행하지 않음)
web tRPC 6파일 제거 + openapi.json REST-기반 교체(같은 커밋) → apps/api tRPC 소비자 부재 증명 → 라우터 단위 제거 → Phase 7-1 인덱스 마이그레이션 → 7-2 FK 승격(고아 검증 선행). 각 제거 커밋에 grep/로그 증거 첨부(마스터플랜 규칙).
