# sangfor-os 개발 마스터 참고문서 (Living Reference)

> **목적**: 개발할 때마다 펴보는 단일 진입점. 시스템 지도 · 워크스트림 · 소스 인벤토리 · 명령어 · 데이터모델 · 알려진 이슈를 한 곳에.
> **유지 규칙**: 작업이 끝날 때마다 이 문서를 갱신한다. 새 워크스트림은 §3에 한 섹션 추가, 명령은 §5, 파일은 §6, 모델 변경은 §7, 이슈는 §8. 맨 아래 **변경 이력** 한 줄 추가.
> **최초 작성**: 2026-06-29 (2026-06-28 작업 일괄 정리) · **마지막 갱신**: 2026-07-28

> **Canonical requirement/acceptance 진입점**: [ID registry](01_SPEC/Requirement_ID_Registry.md) → [requirement source](01_SPEC/Requirements_MoSCoW.md) / [acceptance source](08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md) → [99-row machine manifest](12_VERIFICATION/acceptance-manifest.json) / [evidence schema](12_VERIFICATION/acceptance-evidence.schema.json). 구현 분모는 28 requirements와 71 acceptance이며 C1–C5/W1–W5는 제외한다.

---

## 1. 한눈에 — 어제(2026-06-28) 무엇을 했나

하루에 7개 워크스트림이 모두 `main`에 머지(또는 브랜치 완성)됨. CI(secrets·lint·typecheck·test·build) 통과 기준.

| # | 워크스트림 | 결과 | 위치 | 상세 |
|---|---|---|---|---|
| A | **종축 도메인 워크플로우** | main 머지(PR #35, `d93731c`) | `packages/business/src/domain-*` | §3.A |
| B | **CFO / 재무 모듈** 안정화·실데이터·재디자인 | main 머지(다수 PR) | `apps/api /api/cfo`, `apps/web /cfo` | §3.B |
| C | **MCP 런타임 재현성/신뢰성** | main 머지(PR #21·#26·#29) | `Makefile`, `scripts/`, `services/`, `docker-compose.yml` | §3.C |
| D | **Opportunity→Engagement 전환(P1–P7)** | main 머지(PR #23·#27) | `packages/business/src/engagement-*` | §3.D |
| E | **웹 LLM(OpenAI) 키 관리** | main 머지(PR #30·#32) | `apps/web .../settings/llm`, `openai-config.ts` | §3.E |
| F | **Outlook 메일 동기화 복구 + 대시보드 빈상태화** | main 머지 | `outlook-graph.ts`, `mail-import` | §3.F |
| G | **DB 마이그레이션 정식 전환 + 스냅샷 안전망** | main 머지(PR #25) | `packages/db` | §3.G |

> ✅ **워킹트리 정상화 완료(2026-06-29)**: 이전 손상 상태(도메인 untracked + engagement/llm 삭제표시 = thrashing으로 도메인 머지 이전으로 퇴행)를 `origin/main`(`99c69e9`, 모든 PR 머지된 정본)으로 동기화해 치유. 작업 브랜치 **`dev-clean`**(origin/main 추적). 손상 트리 전체는 백업 브랜치 **`backup/worktree-thrashing-2026-06-29`**(`bc0f133`)에 박제(복구용). thrashing 근원 = 다수 동시 워크트리(`.claude/worktrees/*`, `.worktrees/*`) — §8 참고.

---

## 2. 시스템 지도 (모노레포 + 포트)

pnpm 워크스페이스. Node 20(`.nvmrc`). DB는 Postgres(`prisma db push` 기반 → 마이그레이션 전환 중, §3.G).

### 패키지 / 앱 / 서비스
```
apps/
  api/      → REST API (Nest/Express 계열), /api/cfo 등.  포트 3200
  web/      → Next.js 포털 (App Router).                   포트 3101
packages/
  business/ → 도메인 로직의 핵심. @sangfor/business (domain-*, engagement-*, cfo, mail, opencode 등)
  db/       → Prisma 스키마 + 클라이언트. @sangfor/db (public 스키마 단일 소스)
  shared/   → modes.ts(ROLE_MODES, GTM_PIPELINE), 공용 타입
  agent/    → @sangfor/agent (에이전트 런타임)
  mail-intelligence/, persona/, auth/, config/, infra/, health/, ui/, api-utils/
services/
  sangfor-engineer-mcp/   → MCP 브리지(3600) + operator console(3502), 한 컨테이너
  sangfor-mcp-workflow/   → workflow console(3500), 호스트 실행(컨테이너화 보류)
```

### 포트 맵 (docker-compose)
| 포트 | 서비스 | 헬스 |
|---|---|---|
| 3101 | web (Next.js) | `/` |
| 3200 | api (`/api/cfo` 등) | `/api/health` |
| 3400 | MCP mock console (정적 stub, `mock` 프로파일) | `/` |
| 3500 | MCP workflow console (호스트) | `/api/system/health` (status: ok\|degraded, checks.mcp: connected\|stub) |
| 3502 | MCP operator console (engineer-mcp 컨테이너) | `/api/health/store` |
| 3600 | MCP engineer 브리지 | `/health` |
| 5434→5432 | postgres | `pg_isready -U sangfor` |
| 6380→6379 | redis | `redis-cli ping` |
| 3000 | grafana · 9090 prometheus | — |

> 주의: 과거 문서의 finance `:4100`은 **제거됨**. 재무는 api `:3200/api/cfo`가 단일 소스. compose의 `sangfor-mcp`(3501→3500)는 구형 stub, 실 workflow console은 호스트 3500.

---

## 3. 워크스트림 상세

### 3.A 종축 도메인 워크플로우 (×컬러 렌즈 + 도메인 메모리 + 실 LLM)

**아이디어**: Threads식 멀티에이전트(페르소나 위임)를 sangfor 실제 업무에 맞춤. 기존 컬러 에이전트(Blue/Red/Orange/Gray/Teal/Purple)는 페르소나가 아니라 이미 **도메인 렌즈(focusArea)** 였음 → 교체하지 않고 **종축(업무 도메인) × 횡축(컬러 렌즈)** 직교 매트릭스로 설계.

**종축 GTM 파이프라인**: `마케팅 → 영업 → 프리세일즈 → 엔지니어(SE/현장) → CFO`
- 각 도메인 = **단독-writer 소유 경계**(데이터 오염 방지) + 횡축 컬러렌즈 = **교차 검증** → "정확성이 구조에서 나온다".

| 도메인 | 소유 데이터(단독 writer) | 산출물→핸드오프 | 기본 렌즈 | 민감도 |
|---|---|---|---|---|
| `marketing` | Lead, Campaign | qualified-lead→sales | orange,teal | internal |
| `sales` | Customer, Opportunity, Quote | opportunity+quote→presales | orange,red,gray | internal |
| `presales` | PocProject, GeneratedDocument | technical-proposal→engineer | blue,gray | internal |
| `engineer` | CustomerAsset, SupportCase, DeliveryProject | asset-handoff→cfo | blue,red,purple | **restricted** |
| `cfo` | Invoice, Cashflow, FinanceProject | commercial-approval→완료 | orange,red | **restricted** |

**구성 요소** (모두 `@sangfor/business`에서 export, §6 인벤토리):
- **도메인 메모리**: `DomainMemory`(케이스/규칙/예외, recall 대상) + `DomainDecisionLog`(감사). 모든 조회 `where domain=...`로 격리. recall = 구조적(태그겹침×outcome×confidence) + 임베딩 의미검색(앱레이어 코사인, pgvector 불필요).
- **도메인 AI 런타임**: `runDomainStage`/`runDomainPipeline` — recall→prompt→generate(주입형 LLM)→렌즈→게이트→기록→학습→핸드오프. 게이트 실패 시 핸드오프 중단(같은 도메인 재작업).
- **LLM 백엔드(opencode+OpenAI OAuth)**: `opencode serve`(127.0.0.1:4096) HTTP 호출. **OAuth는 opencode가 처리**(ChatGPT 로그인, 토큰 `auth.json`) → 우리 코드에 토큰 로직 0줄. `createOpencodeDomainGenerator` + 도메인별 `resolveDomainModel`.
- **데이터분류 게이팅**: `resolveDomainModelGated`/`buildGatedModelMap` — 도메인 민감도 × `AiModel.allowedDataClassification` × `isActive`. 비허용 override는 **조용히 낮추지 않고 거부**(보안).
- **구조화 출력**: opencode `format:{type:"json_schema",schema}` → 검증 JSON. ⚠️ 실제 응답 키는 **`info.structured`**(문서의 `structured_output` 아님 — 라이브 테스트로 발견). 도메인별 `DOMAIN_ARTIFACT_SCHEMAS`.
- **가용성 폴백**: `createResilientDomainGenerator([gens],{healthCheck,stub})`(health→primary→fallback→stub). 권장 기본값 `createDefaultDomainGenerator`(구조화→텍스트→stub).
- **임베딩**: `resolveEmbedder`(키 있으면 `createOpenAiEmbedder`, 없으면 `createHashEmbedder` 로컬 폴백). 백필 스크립트 제공.
- **대시보드**: `buildDomainDashboardSnapshot`(주입형 로더) → `/api/domain-pipeline` → `(portal)/domain-pipeline` 페이지 → 사이드바 등록.

**테스트**: ~83 유닛(9 파일). **실증**: 5도메인 실 LLM 한국어 산출물, CFO 구조화 JSON, AiModel 4종 시드 게이팅, 대시보드 HTTP 200, 임베딩 백필 15행.

**사용 예**:
```ts
import { runDomainPipeline, createDefaultDomainGenerator,
         buildGatedModelMap, loadModelPolicyFromDb } from "@sangfor/business";
const registry = await loadModelPolicyFromDb(prisma);
const generate = createDefaultDomainGenerator({ models: buildGatedModelMap({ registry }) });
const results = await runDomainPipeline({ id, subject, tags }, { generate });
```
**상세 문서**: `docs/13_COLOR_AGENT_ORG/Domain_Axis_Project_Report.md`, `Worklog_2026-06-28_Domain_Axis.md`.

---

### 3.B CFO / 재무 모듈

**최종 데이터**: 프로젝트 17 · 미수금 14 · 매입 15 · 자금흐름 179(하나은행, 합계 정확 일치) · 메일 학습 1,778+건.

- **백엔드 단일화**: CFO API = `apps/api` `/api/cfo` (`@sangfor/db` public 스키마). 중복 NestJS(`packages/finance`, 4100, 별도 스키마) **제거**. Prisma 클라이언트 출력 경로 충돌 해결.
- **실데이터 구축**: Notion CFO CSV(프로젝트·미수금·매입·자금흐름) import + 원본 대조 검증. **날짜 off-by-one 수정**(KST 자정→UTC 자정 저장).
- **통장 임포트**: `POST /api/cfo/cashflows/import` — CSV/xlsx 직접(SheetJS), 헤더행 자동탐지·합계행 제외, **중복 자동 제외**(date+cashChange+거래처+적요+`balanceAfter`).
- **프로젝트 자동매칭**: 거래처명 정규화 후 입금→미수금/출금→매입처 해석, import 시 자동 + `POST /api/cfo/cashflows/rematch`.
- **데이터 신뢰성(P0)**: 유실 근본원인 = stale `schema.prisma` + 반복 `db push`로 테이블 drop. → export-only `cfo:snapshot`, U009 격리 restore drill, import footgun 가드(FORCE=1), formal migration 전환(§3.G).
- **품질/보안**: 매칭 단위테스트 + `CI_INTEGRATION` 통합테스트, `financeAccessGuard`(system_admin·finance_manager·ceo만), `FINANCE_API_KEY` 문서화.
- **재디자인(PR #31)**: "잉크 위 장부(ledger)" — 토큰 `lib/cfo-theme`(ink/paper/hairline, 입금 teal·출금 brick·강조 brass), **현금 런웨이 게이지**(0–12개월, 3개월 위험선), 등폭 tabular ₩ 타이포. CFO를 `PortalShell`로 감싸 좌측 사이드바 통일.

**상세 문서**: `docs/08_IMPLEMENTATION/cfo-2026-06-28-worklog.md`, `cfo-stabilization-and-enhancement-plan.md`, `docs/12_VERIFICATION/cfo-runbook.md`.

---

### 3.C MCP 런타임 재현성 / 신뢰성·드리프트 제어

**문제**: 클린 체크아웃에서 MCP 스택이 안 떠오름 + 공유 워킹트리에서 설정 편집이 사라짐. **해결**: 단일 진입점 `make`, in-repo 단일 소스, 정직한 헬스, CI 스모크.

- **단일 진입점**: `Makefile` → `make up`(전체 올그린), `make status`(심층 헬스), `make down`, `make provision`, `make logs`, `make app`, `make integration`, `make help`.
- **오케스트레이션**: `scripts/stack.sh`(컨테이너 기동 → 호스트 의존성 provision → workflow console 기동 → 60초 헬스 대기). `scripts/README.md`가 5개 스크립트를 계층별로 매핑(중복 아님: MCP런타임 / 앱스택 / 통합 / AIOS v1 / 셋업).
- **컨테이너 수정**: engineer-mcp Dockerfile 멀티스테이지에서 `COPY . .` 후 `pnpm install` 재실행으로 pnpm 심볼릭링크 복구(= `pptxgenjs` 모듈 못 찾는 버그 픽스), `.dockerignore`로 호스트 node_modules 덮어쓰기 방지, `docker-entrypoint.sh`로 브리지(3600)+console(3502) 한 컨테이너 동시 기동.
- **소스 단일화**: `mcp-bootstrap.ts`가 `~/Documents` 하드코딩 제거 → 기본 in-repo `services/sangfor-engineer-mcp`(env `SANGFOR_MCP_CWD`로 override). 미발견 시 stub로 폴백하되 **큰 경고**.
- **정직한 헬스**: `/api/system/health`가 HTTP 200 유지하되 `{status, checks:{mcp:connected|stub, auth:configured|missing}}` 반환 → stub를 green으로 착각 방지. 정적 stub는 `mock` compose 프로파일 뒤로 격리.
- **CI 스모크**: `.github/workflows/stack-smoke.yml` — 컨테이너 스택 빌드·기동 후 3600/3502/3400이 60초 내 200인지 단언(경로 필터). 첫 실행에서 실제 Dockerfile 버그 포착.
- **Node 핀**: `.nvmrc`=20.

**상세 문서**: `docs/plans/reproducibility-and-config-durability-plan.md`(A0–A9 감사), `docs/plans/mcp-runtime-reproducibility-report.md`(딜리버리). 또한 `memory/`의 [MCP services startup] 메모.

---

### 3.D Opportunity → Engagement(프로젝트) 전환 (P1–P7)

POC 확정 시 영업기회를 **멱등·원자적**으로 Engagement(프로젝트 워크스페이스)로 전환. 전환 시 제안서·견적·미팅노트·(opt-in)POC를 흡수해 빈 껍데기 문제 해소.

- **게이트**: stage ∈ {PROPOSAL,POC,NEGOTIATION,WON} **and** 연결된 POC 존재(없으면 `force=true`). WON 자동 아님 — POC 단계 사전 기획 허용.
- **멱등성**: `Engagement.opportunityId @unique`가 잠금. 동시 호출은 P2002 캐치 후 기존 Engagement 반환(중복 흡수 없음). 모든 자식 쓰기는 `$transaction` 내 tx 클라이언트로.
- **금액**: 최신 **non-draft** Quote의 `totalRevenue` 스냅샷(합산 금지, opp.amount 폴백 금지).
- **미팅 승격(P5–P7)**: `promoteMeetingThreads` — 메일 스레드 키워드 점수(distinct≥2 → `confirmed`, 미만 `suggested`). **트랜잭션 밖(post-commit)** 실행(노이즈가 전환을 깨지 않도록). 캘린더 동기화(P7)는 `source="calendar"`.

**데이터 모델 변경**(§7에 통합):
- `DeliveryProject` → **`Engagement`**(물리 테이블 `delivery_projects` 유지, `@@map`). +`opportunityId @unique`, `status`(planned/pre_engagement/...), `convertedAt/convertedFromStage`, `amount/amountQuoteId`.
- **`MeetingNote`**(신규): opportunityId/engagementId, `mailInsightThreadId`, `source`(manual/mail/calendar), `status`(confirmed/suggested), `@@unique([opportunityId, mailInsightThreadId])`.
- `GeneratedDocument` +opportunityId/engagementId (P2: `generateProposal`가 opportunityId를 파싱만 하고 저장 안 하던 버그 수정 + 백필).
- `PocProject` +opportunityId/engagementId (48개 메일 POC 백필, going-forward `createPocProject`가 자동 링크).
- `MailMessage` +externalId @unique, conversationId, direction, toEmail, receivedAt. `MailAccount` +OAuth 토큰 컬럼.

**API**: `PATCH /api/opportunities/[id]` `{action:"convert_to_project"}`, `GET /api/engagements`, `GET /api/engagements/[id]`. **테스트**: `engagement-conversion.test.ts`(`CI_INTEGRATION=1` 게이트, 멱등·흡수·POC게이트).

> ⚠️ 현재 워킹트리에서 `engagement-center.ts`/`engagement-backfill.ts`/`meeting-promotion.ts`가 삭제 표시. **머지본(main) 기준으로 복원** 후 사용.
**상세 문서**: `docs/plans/opportunity-to-project-conversion.md`.

---

### 3.E 웹 LLM(OpenAI) 키 관리

`.env` 편집·OAuth 없이 **웹 UI에서 OpenAI 키/베이스/모델 입력** → DB 저장 → 런타임 hydration. 웹 저장값이 stale env를 **override**.

- **저장/적용**: `llm-settings.ts`(`saveLlmSettings`/`loadLlmConfigFromDb`/`getLlmSettingsStatus`) → DB `config_profiles`/`config_values`. ⚠️ 현재 워킹트리에서 `llm-settings.ts` 삭제 표시(머지본 기준).
- **진입점 hydration**: `mail-candidates.ts`·`proposal-generator.ts`가 AI 호출 전 `loadLlmConfigFromDb()` 호출 → `openai-config.ts`의 동기 getter(process.env 기반)가 웹 저장값을 보게 됨.
- **UI**: Settings → "LLM(OpenAI 호환) 키" 카드. 키는 마스킹 표시(`sk-…1234`), 소스(.env vs 웹저장) 표기. 빈 문자열=클리어, undefined=유지.
- **키 자동감지**: `sk-`(OpenAI pay-as-you-go) vs `tp-`(MiMo Token Plan) prefix로 base URL 자동 매핑.
- **precedence 픽스(`c830b98`)**: 웹 저장값 > env. 남아있는 `OPENAI_BASE_URL` env가 무시될 수 있음(gotcha).
- **API**: `GET/POST /api/settings/llm`(GET은 마스킹 상태만, 전체 키 미반환).

---

### 3.F Outlook 메일 동기화 복구 + 대시보드 빈상태화

- **위임형(delegated) OAuth 복구**: `apps/web/src/lib/outlook-graph.ts` — 토큰 교환/갱신, Inbox+Sent 동기화(direction 태깅, conversationId 그룹). `connectOutlookAccount`/`syncDelegatedOutlook`/`syncCalendarMeetings`/`sanitizeText`.
- **우선순위**: `mail-import` 라우트가 **위임형 우선**, 없으면 app-only(`outlook-sync.ts`, client_credentials, env `OUTLOOK_CLIENT_ID/SECRET/TENANT_ID`)로 폴백.
- **toInputJson surrogate 픽스**: jsonb 저장 전 lone UTF-16 surrogate + C0 제어문자 제거(`sanitizeJsonStrings`, 재귀 적용). 잘린 이모지/CJK가 직렬화 크래시 내던 것 방지.
- **대시보드 빈상태화**: 하드코딩 mock 제거 → `/api/dashboard/[role]`가 DB 실데이터 조회, 없으면 빈 배열(메일 학습으로 채워짐).
- **OAuth 콜백**: 기본 `http://localhost:3101/api/mail/oauth/callback`(env `OUTLOOK_REDIRECT_URI`). 스코프: `Mail.Read User.Read offline_access`(+캘린더 `Calendars.Read`).

> `memory/`의 [Outlook mail integration], [Dashboards emptied for mail learning] 메모와 연계. 자격증명은 `apps/web/.env.local`.

---

### 3.J 프로젝트 허브 = 도메인 파이프라인 인스턴스 Phase 1 (PR #40, 브랜치 `feat-project-hub`)

- **재정의**: 프로젝트(Engagement) = 도메인 파이프라인(마케팅→세일즈→프리세일즈→엔지니어→CFO) 인스턴스. CFO는 중심이 아니라 한 레인. 제품 철학(업무자동화 OS, human-in-loop, 학습→자율) 기준 — memory `product-philosophy-human-in-loop-learning`.
- **Phase 1(읽기전용 통합뷰 + 실손익)**: `Invoice/Expense/TaxInvoice.engagementId?`(additive 마이그레이션) + 순수함수 `computePnl`(매출−매입−비용; TaxInvoice는 direction 분리)·`buildLanes`(아티팩트→도메인, 빈 도메인 pending) + `getProjectHub(engagementId)`(engagementId **단일 축**, 레거시 CFO는 FinanceProject 축 → 이중집계 없음) + `GET /api/projects/[id]/hub` + `/projects/[id]` 도메인 레인 코크핏.
- **방법론**: 검증→설계→독립비판(opus)→재설계→TDD→라이브검증. 비판이 초안 오류(`caseRef≠engagementId`, 빈데이터 가정) 교정. 라이브에서 레인상태 버그 발견·수정.
- **Phase 2 (완료, 2026-06-30)**: 사람 개입+학습 루프. `project-decision.ts` `recordHumanDecision`(caseRef='eng:'+id, decisionType='human_review' → DomainDecisionLog + DomainMemory 학습) + `computeAutonomy`(순수, 사람-신호 행만; 표본<3=학습중) + getProjectHub 레인별 autonomy. API `POST /api/projects/[id]/domain-decision`. UI: 허브 레인마다 승인/수정/반려 + 자율도 배지. 라이브검증: cfo 자율도 75%/보통/표본4(3승인+1수정). (caseRef 규약으로 스키마 변경 없이 critic의 caseRef 모호성 회피.)
- **전체메일 ground-truth 분류 (2026-06-30)**: 게이트웨이 대신 Claude가 96 거래처 도메인 직접 분류(3배치+2차리뷰+사용자 정정) → customers/partners 재구축 **고객 15·파트너 49**(기존 규칙기반 61고객 부정확분을 교정). 기준: 모호 한국 IT/SI=partner, 글로벌 SaaS=vendor. memory `full-mailbox-ground-truth-classification`.
- **AI 배치 분류 (2026-06-30)**: `ai-classify-batch.ts` `withBackoff`+`mapPool`(429 견딤, 동시성 제한) + ground-truth를 classifyWithAI 프롬프트에 주입. 새 메일은 이 설정을 따름.
- 설계/계획: `docs/superpowers/{specs,plans}/2026-06-29-project-hub-*`.

### 3.I 메일→고객/파트너 분류 품질 + AI (PR #39, 브랜치 `feat-mail-entity-quality`)
- 도메인 기반 정규화·벤더/SaaS 필터·canonical 이름 병합(`packages/business/src/mail-entity-quality.ts`), AI 하이브리드 분류기에 vendor 카테고리+고객/파트너 교정, `mail-learn`이 LLM 키 있을 때 AI. convert가 stale 프로젝트ID 쓰던 버그 수정(실제 demo-project 해석). 실데이터: 고객 정크 0·중복 0. AI 키(OpenCode, OpenAI 호환)는 `.env OPENAI_*` — 미설정 시 규칙기반 폴백. memory `mail-to-customer-partner-pipeline`.

### 3.H CFO 세금계산서 자동 처리 — 홈택스 보안메일 자체 복호화 (PR #38, 브랜치 `feat-cfo-tax-invoice-automation`)

- **무엇**: 받은 세금계산서(매입) 완전 자동(수집→복호화→파싱→매입 TaxInvoice+Expense+원장 멱등 반영) + 발행(매출) 작성·원장 자동(국세청 전송만 수동, 교체형 어댑터). **팝빌 없음.**
- **핵심**: 국세청 홈택스 발급 메일 첨부 `NTS_eTaxInvoice.html`은 보안메일(암호화). 국세청 공개 `cri_ems_nt.js` 로직 재현 → `Base64+XOR0x6b 헤더 → SEED/AES-CBC(키=MD5(회사 사업자번호), IV=0) → Base64 디코드 → 표준 TaxInvoice XML`. 실제 메일로 검증. 엔진: `apps/api/src/services/finance/hometax-securemail/`(벤더링 CryptoJS rollup).
- **안전장치**: 승인번호(`issueId @unique`)+P2002 멱등 / 실패격리(`failed`) / 사업자번호 불일치(`skipped_not_ours`) / 원장실패(`ledger_failed`) / KST 작성일자. 회사 사업자번호=복호화 키는 설정 DB(`CompanySettings`).
- **연동**: Outlook 동기화(`apps/web/.../outlook-graph.ts`) 시 홈택스 메일 자동 인입 + `.html` 수동 업로드 폴백. UI: `cfo/(cfo)/tax-invoices`(매입/매출) + 설정 사업자번호. REST `/api/cfo/tax-invoices`·`/company-settings`.
- **테스트**: 단위+통합 31/31(통합은 `CI_INTEGRATION=1`, 공유 DB라 직렬 — `vitest.config.ts fileParallelism`). 서브에이전트 TDD + 최종 전체리뷰 통과.
- **마이그레이션**: §3.G 전환에 맞춰 `db push` 대신 정식 마이그레이션 생성(`migrate diff` + shadow DB). 설계/계획: `docs/superpowers/{specs,plans}/2026-06-29-cfo-tax-invoice-automation*`.

### 3.G DB 마이그레이션 정식 전환 + 스냅샷 안전망 (PR #25, `fb8d5a5`)

- **근본 문제**: `prisma migrate dev`는 파괴적 리셋을 요구 → 메일/재무 데이터 보호 위해 그동안 `db push` 사용. 그러나 stale 스키마 + 반복 push가 테이블 drop을 유발(데이터 유실).
- **전환**: db-push 갭을 baseline 마이그레이션으로 생성, fresh DB에서 `migrate deploy` → schema와 empty-diff 검증. **CI test를 `db:push` → `db:migrate:deploy`** 로 전환.
- **안전망**: `cfo:snapshot`은 export-only이며, U009 isolated restore drill이 복원 검증의 유일한 자동 경로다. 직접 `db push`와 `cfo:restore`는 U031에서 폐기됐다.
- **규칙**: 스키마 변경 전 반드시 `git diff origin/main -- packages/db/prisma/schema.prisma` 확인. `db push --accept-data-loss` 금지.

> `memory/`의 [DB uses db push not migrate] 메모는 이 전환으로 갱신 필요(현재 마이그레이션 전환 중).

### 3.K R16–R20 실사용 5라운드 QA (2026-07-13)

- **범위**: 라운드당 10개, 총 50개 시나리오로 교정/보관, 기능 도달성, CFO 진실성, 모바일·한국어·키보드, 동결 회귀를 검증했다. Sol이 격리 환경에서 실행하고 Grok이 각 라운드를 독립 반례검토했다.
- **주요 착륙**: Contact 교정/soft archive, partner/contact tenant scope, 안정적인 전환 409+명시적 force, renewal 상태 변경, 월마감 실행, VAT 기간 선택, CFO 미수·현금 SSOT, subscription API 계약, CFO-local 404, 모바일/한국어/오류 피드백.
- **안전/발견**: 기능 쓰기는 QA DB `sangfor_os_uxtest_r16r20`, Redis DB 14, web 3110/api 3230에서 수행했다. 다만 기존 비격리 business 테스트 4개가 루트 `.env` 운영 DB에 감사 로그 34행을 남기는 결함을 발견해 `CI_INTEGRATION=1` 게이트와 cleanup을 추가했다. 남은 운영 로그 삭제는 승인 대기다.
- **상세 증거**: [`docs/plans/2026-07-13-r16-r20-real-usage-qa.md`](plans/2026-07-13-r16-r20-real-usage-qa.md).

### 3.L AI 품질 커널 (U054)

- **핵심**: AI 산출물의 수치/규칙 기반 자동 품질 평가(`aiQualityAssessment`), 다중 역량 인간 리뷰(`aiQualityReview`), 최종 릴리즈 승인 판단(`aiReleaseEvaluation`)을 다루는 가버넌스 커널.
- **주요 규칙**: `qualityPassed`는 수치/규칙 기반 자동 평가 통과 여부일 뿐, 최종 릴리즈/발송 승인을 의미하지 않는다. 2-of-2 human review complete와 release evaluation(`eligible: true`)이 모두 충족되어야 최종 발송이 허가된다.
- **Policy/Slot/Quorum 규격**:

| policyKey | quorum | slot 1 (order 1) | slot 2 (order 2) |
|---|---|---|---|
| `proposal.human_review.v1` | 2 | `proposal.presales` (presales_engineer, `ai_quality.review`) | `proposal.account` (account_manager, `ai_quality.review`) |
| `domain_proposal.human_review.v1` | 2 | `domain_proposal.architect` (solution_architect, `ai_quality.review`) | `domain_proposal.account` (account_manager, `ai_quality.review`) |
| `quote.internal_release.human_review.v1` | 2 | `quote.internal_release.sales` (sales_manager, `ai_quality.review`) | `quote.internal_release.finance` (finance_manager, `ai_quality.review`) |
| `support.rca.human_review.v1` | 2 | `support.rca.support_lead` (support_engineer, `support.rca.review.lead`) | `support.rca.solution_architect` (solution_architect, `support.rca.review.architect`) |

- **커맨드 & 룩업**:
  - `completeCurrentAiQualityAssessment`: 버전/해시 스냅샷 검증 후 품질 평가를 완료하고 불변 레코드 생성.
  - `submitAiQualityReview`: human review 제출. Slot 순서, businessRole, capability, 동일 User ID(대체 멤버십 포함) 차단 검증.
  - `completeCurrentAiReleaseEvaluation`: 2-of-2 review set 완성 및 quality eligibility 평가 후 release evaluation 결정을 생성.
  - 룩업: `evaluateCurrentReviewSet` (slot 검증 및 reviewSetHash), `requireCurrentAiReleaseEvaluation` (최신 release evaluation 조회).
- **에러 409 코드**: `AI_QUALITY_IDEMPOTENCY_CONFLICT`, `AI_QUALITY_SNAPSHOT_STALE`, `AI_RELEASE_EVALUATION_IDEMPOTENCY_CONFLICT`, `AI_RELEASE_EVALUATION_STALE`.

---

## 4. 핵심 워크플로우 (개발 순서)

`memory/` [Dev workflow: screen-first] 기준:
1. **화면 먼저** (figma + frontend-design 스킬) → 2. **화면-흐름 다이어그램** → 3. **기능 코딩**.

도메인 파이프라인 런타임 흐름:
```
인입(subject,tags) → recall(few-shot, 구조적+임베딩) → prompt
  → generate(게이팅된 LLM) → 컬러 렌즈 검토 → 게이트
  → 결정 기록(DomainDecisionLog) → outcome로 메모리 학습 → 다음 도메인 핸드오프
```

---

## 5. 명령어 모음

### 환경 변수
루트 `.env.example`(공유 인프라: DB/Redis/LLM/커넥터)에 더해, 앱/패키지별로
실제로 읽는 env var만 문서화한 예시 파일이 있다:
- `apps/web/.env.example`
- `apps/api/.env.example`
- `packages/business/.env.example`
- `packages/db/.env.example`
- `services/sangfor-engineer-mcp/.env.example`
- `services/sangfor-mcp-workflow/.env.example`

코드가 참조하는 고유 env 변수는 web 29 / api 18 / business 36 (합집합 73)개로 example 파일들이 전부를 덮지는 않음 — 신규 변수 추가 시 해당 example 파일에 같이 추가할 것.

### 서비스 기동
```bash
# MCP 런타임 전체 (브리지/콘솔/mock + 호스트 workflow console)
make up                 # 전체 올그린(60초 헬스 대기)
make status             # 심층 헬스(4 엔드포인트 + pg/redis + MCP connected/stub)
make down               # 정지
make help               # 전체 타깃

# 앱 스택
pnpm docker:dev                          # postgres(5434)+redis(6380)
pnpm --filter @sangfor/api dev           # api  :3200  (/api/cfo)
pnpm --filter @sangfor/web dev           # web  :3101  (/cfo, /domain-pipeline)
make app                                 # 앱 스택 일괄

# LLM 백엔드(도메인 실 LLM)
opencode auth login                      # OpenAI → ChatGPT Plus/Pro (1회)
opencode serve --port 4096

# 로컬 스택 원커맨드 (포트정리·ulimit·WATCHPACK·AUTH_BYPASS 자동 처리)
scripts/dev-up.sh                        # postgres + api(:3200) + web(:3101), 헬스까지 대기
scripts/dev-smoke.sh                     # 핵심 라우트 200/307 스모크
scripts/dev-down.sh                      # api/web 정지 (postgres 유지; --db로 함께 정지)
```

### 단일 호스트 운영 배포
`docker-compose.production.yml`은 DB/Redis를 호스트에 공개하지 않고, 정식 Prisma migration →
`sangfor_app_login` 비밀번호 설정 → API/Web health → Caddy TLS ingress 순서를 fail-closed로 강제한다.

```bash
cp production.env.example .env.production
chmod 600 .env.production
# 모든 placeholder를 서로 다른 실제 비밀값과 운영 도메인으로 교체
# production-authority.example.json을 root-owned 0600
# /etc/sangfor-os/production-authority.json으로 프로비저닝
scripts/deploy-production.sh --env-file .env.production --check
scripts/deploy-production.sh --env-file .env.production \
  --final-acceptance /absolute/path/final-acceptance.json \
  --external-receipt /absolute/path/ac-dod-09-pass.json \
  --confirm-production
```

배포는 tracked worktree가 깨끗하고 `--confirm-production`이 있을 때만 실행되며, Caddy를 통한
외부 `/health`와 `/login` HTTPS probe까지 성공해야 완료된다. DB/Redis/API/Web은 host port를
publish하지 않으며 Caddy의 80/443만 공개한다. 실제 운영 전에는 별도로 AC-DOD-09
외부 staging connector 검증과 DNS/TLS 도메인 준비가 필요하다.
운영 로그인은 사용자별 scrypt credential만 허용하며 `AUTH_DEMO_PASSWORD`는 거부한다. 마이그레이션
전 dump와 SHA 이미지 rollback 절차는 `docs/12_VERIFICATION/production-deployment-runbook.md`를 따른다.

### 개선 라운드 워크플로우 (`/round` 스킬 + auto-merge)
반복적인 fix/cleanup 라운드는 `.claude/skills/round/SKILL.md`(`/round`)로 표준화됨.
격리 worktree → 파일범위 분리 병렬 에이전트 → `scripts/dev-up.sh`+검증 → `scripts/round-ship.sh`.

```bash
# 라운드 배포: 커밋+push+PR+auto-merge(squash)를 한 번에
scripts/round-ship.sh improve/round-N "fix(round-N): 요약" "본문"
gh pr checks --watch                     # (선택) CI 진행만 지켜보기 — sleep 폴링 금지
```

**Auto-merge 설정** (한 번만): repo 토글은 활성화됨(`allow_auto_merge`, `delete_branch_on_merge`).
CI 게이팅을 실제로 걸려면 `main`에 branch protection + required checks 필요:
```bash
gh api -X PUT repos/whelp99-code/sangfor-os/branches/main/protection \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[checks][][context]=build' \
  -f 'required_status_checks[checks][][context]=lint' \
  -f 'required_status_checks[checks][][context]=test' \
  -f 'required_status_checks[checks][][context]=typecheck' \
  -f 'required_status_checks[checks][][context]=secrets-scan' \
  -F 'enforce_admins=false' -F 'required_pull_request_reviews=null' -F 'restrictions=null'
```
설정 후 `scripts/round-ship.sh`의 `gh pr merge --auto`가 CI green 시 자동 머지.
branch protection 없으면 `--auto`는 mergeable 즉시 머지(게이트 없음)이므로,
다른 세션이 main에 함께 머지 중이면 required checks 설정을 권장.

### DB
```bash
cd packages/db && npx prisma generate
pnpm --filter @sangfor/db db:migrate:deploy   # 정식(마이그레이션)
pnpm --filter @sangfor/db cfo:snapshot         # 비파괴 백업
pnpm restore:drill                             # U009 격리 fixture 복원 검증
pnpm verify:operational-entrypoints            # 금지된 운영 진입점 검사
# 스키마 변경 전 필수:
git diff origin/main -- packages/db/prisma/schema.prisma
```

### 검증/실증 스크립트 (`packages/business/scripts/`)
```bash
npx tsx packages/business/scripts/verify-polish.ts            # 게이팅/대시보드/임베더
npx tsx packages/business/scripts/seed-ai-models.ts           # AiModel 4종 시드(게이팅)
npx tsx packages/business/scripts/domain-structured-e2e.ts    # 구조화 출력(opencode 필요)
npx tsx packages/business/scripts/backfill-domain-embeddings.ts  # 임베딩 백필
```

### 품질 게이트 (머지 전)
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
# 통합 테스트: CI_INTEGRATION=1 (DB 의존 경로)
```

---

## 6. 소스 인벤토리 (파일 → 역할)

### `packages/business/src/` — 도메인 워크플로우 (모두 `index.ts`에서 export)
| 파일 | 역할 |
|---|---|
| `domain-pipeline.ts` | 도메인 정의 + 도메인→컬러렌즈(`routeColorAgents`) + 핸드오프 |
| `domain-memory.ts` | 구조적 recall + write/log (소유 경계 격리) |
| `domain-agent-runtime.ts` | 도메인 AI 런타임(주입형 LLM) + stub 생성기 |
| `domain-embedding.ts` | 임베딩 의미 recall(코사인/하이브리드) |
| `domain-model-policy.ts` | 데이터분류 게이팅(`buildGatedModelMap`, `loadModelPolicyFromDb`) |
| `opencode-client.ts` | opencode 서버 HTTP 클라이언트 |
| `domain-llm.ts` | opencode 백엔드 생성기 + 모델 라우팅(`resolveDomainModel`) |
| `domain-artifact-schema.ts` | 도메인별 출력 JSON 스키마(`DOMAIN_ARTIFACT_SCHEMAS`) |
| `opencode-structured.ts` | opencode 구조화 출력(format, `info.structured`) |
| `domain-structured.ts` | 구조화 출력 생성기 |
| `domain-llm-fallback.ts` | 가용성 폴백 체인(`createResilientDomainGenerator`) |
| `domain-default-generator.ts` | 권장 기본 생성기(구조화→텍스트→stub). **runDomainPipeline의 기본값**(generate 미주입 시 `resolveDomainGenerator`가 자동 사용) |
| `domain-persistence.ts` | **구조화 산출물→실 DB 레코드 매핑**(`createDomainPersister`, 멱등 `dompipe:*` id). runtime `persist` 주입점 |
| `domain-dashboard.ts` | 대시보드 스냅샷 빌더(`buildDomainDashboardSnapshot`) + outcomeBreakdown/recentDecisions |
| `domain-embedder.ts` | 로컬 해시 임베더(`createHashEmbedder`) |
| `domain-embedder-openai.ts` | OpenAI 임베더 + `resolveEmbedder` |

웹(대시보드): `apps/web/.../api/domain-pipeline/stream/route.ts`(SSE 실시간), `(portal)/domain-pipeline/page.tsx`(EventSource·카드 상세). CFO: `components/cfo/page-heading.tsx`(공유 ledger 머스트헤드).

### `packages/business/src/` — 기타 핵심(어제 관련)
| 파일 | 역할 |
|---|---|
| `engagement-center.ts` | Opportunity→Engagement 전환 코어(멱등·흡수) ※현재 트리 삭제표시 |
| `meeting-promotion.ts` | 메일 스레드→MeetingNote 승격(키워드 점수) ※현재 트리 삭제표시 |
| `engagement-backfill.ts` | POC/제안서 opportunityId 백필 ※현재 트리 삭제표시 |
| `poc-center.ts` | POC 생성(+opportunityId 자동 링크) |
| `proposal-generator.ts` | 제안서 생성(+opportunityId 저장, LLM hydration) |
| `mail-candidates.ts` | re-export 배럴(20줄) — 실 로직은 `mail/` 모듈(Phase 4 분해, 2026-07-10 실측 반영) |
| `mail/constants.ts` · `mail/classify-rules.ts` | 분류 상수·순수 규칙 분류(+`sanitizeJsonStrings` 소비) |
| `mail/classify-ai.ts` | AI 재검증(LLM hydration, 자가치유 캐시, `stripJsonCodeFence`) |
| `mail/candidates-generate.ts` · `mail/candidates-update.ts` | 후보 생성(아티팩트 필터 포함)·갱신/전환 |
| `mail/policy-decision-log.ts` | legacy 감사 스트림 writer(@deprecated, ADR-001 D2) |
| `mail/outlook/outlook-sync.ts` | app-only Outlook 동기화(client_credentials) — 구 `outlook-sync.ts`에서 이동 |
| `openai-config.ts` | OpenAI 키/베이스/모델 동기 getter |
| `llm-settings.ts` | 웹 LLM 설정 저장/로드/적용 ※현재 트리 삭제표시 |

### `apps/web` (App Router)
| 경로 | 역할 |
|---|---|
| `src/app/(portal)/domain-pipeline/page.tsx` | 도메인 대시보드 페이지 |
| `src/app/api/domain-pipeline/route.ts` | 대시보드 스냅샷 API |
| `src/app/api/settings/llm/route.ts` | 웹 LLM 키 GET/POST |
| `src/app/api/engagements/[route]` | Engagement 목록/상세 |
| `src/app/api/opportunities/[id]/route.ts` | 전환 액션(`convert_to_project`) |
| `src/app/api/mail-import/route.ts` | 메일 동기화(위임형 우선) |
| `packages/business/src/mail/outlook/outlook-graph.ts` | 위임형 OAuth + Graph 동기화 (구 `apps/web/src/lib`에서 이동) |
| `src/lib/cfo-theme.ts` | CFO ledger 테마 토큰 |

### 루트 / 인프라
| 경로 | 역할 |
|---|---|
| `Makefile` | MCP/스택 단일 진입점 |
| `scripts/stack.sh`, `scripts/README.md` | 오케스트레이션 + 스크립트 맵 |
| `docker-compose.yml` | 전체 서비스 정의(포트 §2) |
| `services/sangfor-engineer-mcp/` | MCP 브리지+console(Dockerfile, entrypoint, .dockerignore) |
| `services/sangfor-mcp-workflow/` | workflow console(start-console.sh, mcp-bootstrap.ts) |
| `.github/workflows/stack-smoke.yml` | MCP 스택 CI 스모크 |
| `.nvmrc` | Node 20 |

### `packages/shared` / `packages/db`
- `shared/src/modes.ts` — `ROLE_MODES`(+marketing,engineer), `GTM_PIPELINE`/`nextGtmDomain`/`isGtmDomain`.
- `db/prisma/schema.prisma` — 모든 모델(§7). `db/prisma/sql/domain_axis_tables.sql`, `domain_axis_embedding.sql`(additive DDL).

---

## 7. 데이터 모델 변경 (2026-06-28 누적)

| 모델 | 변경 |
|---|---|
| `DomainMemory` | 신규(+`embedding`). 케이스/규칙/예외, domain별 격리 |
| `DomainDecisionLog` | 신규. 입력·결정·게이트·인간수정 감사 |
| `Engagement`(←`DeliveryProject`) | 리네임(물리 `delivery_projects` 유지). +opportunityId @unique, status, convertedAt/convertedFromStage, amount/amountQuoteId, projectId/customerId |
| `MeetingNote` | 신규. opportunityId/engagementId, mailInsightThreadId, source, status, @@unique([opportunityId,mailInsightThreadId]) |
| `GeneratedDocument` | +opportunityId, +engagementId |
| `PocProject` | +opportunityId, +engagementId |
| `MailMessage` | +externalId @unique, conversationId, direction, toEmail, receivedAt |
| `MailAccount` | +tenantId, accessToken, refreshToken, tokenExpiresAt, tokenScope, lastSyncedAt |
| `FinanceProject` | +거래처, 시작일, 종료일 |
| `Invoice` | +발행일 |
| `AiModel` | 게이팅용(allowedDataClassification, isActive) — 시드 스크립트로 4종 |
| `Contact` | +`archivedAt?`, +`updatedAt`; 연락처 교정·soft archive용 additive migration `20260713143000_contact_corrections` |

> 전부 **additive/nullable** 원칙. 변경 시 §3.G 안전 절차 준수.

---

## 8. 알려진 이슈 / 게이트 / gotchas

- **공유 워킹트리 thrashing (근원 규명됨)**: 리포에 동시 워크트리가 다수 존재 — `.claude/worktrees/agent-*`(에이전트 워크트리), `.worktrees/opportunity-to-engagement`(여기에 `main`이 점유됨, stale 9fc7084), `.worktrees/task1-*`, `.worktrees/task-2-*`. 이들이 공유 루트 트리의 브랜치를 실시간 전환·되돌려 추적파일 편집이 유실됨. **`main`은 다른 워크트리가 점유**하므로 루트에서 `git checkout main` 불가 → 루트 작업은 `origin/main`에서 새 브랜치(`dev-clean` 등)로. 대응: 전용 브랜치 **조기 커밋**, 손상 시 `origin/main`으로 동기화 + 손상본은 백업 브랜치로 박제, 실행 전 `git restore --source=origin/main`. 정리 시 불필요한 워크트리는 `git worktree remove`.
- **apps/web prod `next build` 사전파손**: `/`, `/development/improvements`에서 useMemo null. dev는 동작. (memory [Web build pre-broken])
- **opencode 구조화 출력 키**: 문서의 `structured_output`이 아니라 **`info.structured`**. 라이브로만 발견됨.
- **CI가 잡는 함정 2종**(도메인): `resolveProjectId` export 충돌(TS2308, vitest/esbuild는 못 잡고 전체 `tsc`가 잡음 → `resolveDomainProjectId`로 개명), `modes.test.ts` ROLE_MODES exact-equality.
- **데이터분류 override 거부**: 비허용 모델 강제 시 조용한 다운그레이드 금지, **거부**.
- **Engagement 멱등성**: 앱 로직이 아니라 `@unique` 제약 + `$transaction`. P2002 캐치 필수.
- **pre_engagement 버킷**: 대시보드 KPI에 `status="pre_engagement"` 명시 버킷 없으면 신규 프로젝트 누락.
- **웹 LLM precedence**: 남은 `OPENAI_*` env가 웹 저장값에 가려짐.
- **lone surrogate jsonb 크래시**: 메일 저장 전 `sanitizeJsonStrings` 필수.
- **finance 포트 4100 제거됨**: `:3200/api/cfo`가 단일 소스.
- **워크트리 셋업 순서(중요)**: 새 git worktree는 ① 루트 `.env` + `packages/db/.env`(필요 시 `apps/web/.env.local`도) 복사 → ② `pnpm install` → ③ `cd packages/db && npx prisma generate` 순서를 반드시 지킨다. 순서가 틀리면(특히 env 복사 전에 install/generate) Prisma 클라이언트가 env 경로를 못 캡처해 테스트가 `DATABASE_URL not found`로 실패하는데, 이는 회귀가 아니라 순서 문제다.
- **API 부팅 전 워크스페이스 패키지 빌드 필요**: 새 워크트리에는 `packages/*/dist`가 없다. `pnpm --filter @sangfor/shared build`/`@sangfor/config build`만으로 부족한 경우(예: `apps/api`가 `@sangfor/auth`, `@sangfor/api-utils`, `@sangfor/health`, `@sangfor/infra`, `@sangfor/persona` 등 dist-only 패키지를 요구해 boot 시 `Cannot find module '.../dist/index.js'`로 크래시) `pnpm -r --filter "./packages/**" build`로 전체를 빌드한다. `src`를 `exports`로 직접 노출하는 패키지(agent/business/mail-intelligence)는 `--noEmit` 타입체크만 있으면 되고 dist가 불필요하다.
- **`(portal)/loading.tsx` 스트리밍 컨텍스트의 redirect 강등**: 이 레이아웃의 스트리밍 컨텍스트 안에서는 page-level `redirect()`(Next.js 서버 함수)가 실제 307이 아니라 **meta-refresh로 강등**된다. 라우트 통합/리다이렉트가 필요하면 page 컴포넌트의 `redirect()` 대신 **`next.config.ts`의 `redirects()`**를 써서 실 307을 보장한다(`/opportunities`→`/deals`, `/mail-connection`→`/settings/mail-connection` 전환에서 발견·적용, PR #101).
- **opencode 샌드박스는 `.env`를 못 읽는다**: opencode CLI로 위임한 작업이 DB 관련 코드를 만지면 샌드박스가 프로젝트 `.env`를 읽지 못해 `DATABASE_URL`이 비어 실패할 수 있다 — 호출 전에 `DATABASE_URL`을 환경변수로 선주입해야 한다.
- **e2e는 이제 CI 차단 체크**: `playwright.config.ts`에 `webServer`가 추가돼 API(`tsx` 경유, dist ESM directory-import 버그로 dist 실행 불가)와 web(`next start`)을 스스로 기동한다. `PORT`/`API_PORT` 오버라이드로 로컬의 다른 인스턴스와 포트 충돌 없이 별도 포트에서 돌릴 수 있다(`BASE_URL`/`API_BASE_URL`이 그 포트를 따라간다). `continue-on-error`가 제거됐으므로 e2e 실패는 이제 실제로 머지를 막는다(PR #99).
- **9router `cx/gpt-5.4-mini` 쿼터는 모델 단위 공유 한도**: 스크립트가 `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL`을 셸에서 직접 override해도, 같은 모델을 부르는 다른 프로세스(예: main-fork 프로드)와 쿼터를 공유한다 — 429 발생 시 `curl :20128/v1/chat/completions`로 직접 재시도해 실제 리셋 카운트다운(수십 분 단위 rolling window)을 확인하고, 리셋될 때까지 해당 모델을 쓰는 배치를 잠깐 멈추는 게 낫다(무작정 재시도하면 fallback 결과만 반복 기록됨).
- **DB 컬럼 케이싱 비일관**: 대부분 `@map`으로 snake_case(`engagement_id`)지만 `MailDerivedCandidate.metadata`처럼 일부 필드(예: `FinanceProject.projectId`류)는 예외적으로 camelCase로 매핑돼 있다. raw SQL(`psql -c`) 작성 전 `schema.prisma`에서 해당 필드의 `@map` 유무를 확인할 것 — 안 그러면 "column does not exist" 오탐이 반복된다.
- **psql은 Prisma `DATABASE_URL`의 `?schema=` 쿼리파라미터를 거부**: `psql "$DATABASE_URL"`이 `invalid URI query parameter: "schema"`로 즉시 실패한다. `${DATABASE_URL%%\?*}`로 잘라내고 사용(`scripts/kpi-weekly.sh` 참고).
- **테넌시 이전(pre-tenancy) dev DB는 마이그레이션이 2단으로 막힌다**: 오래된 로컬 `sangfor_os`처럼 테넌트·회사 없이 프로젝트만 있던 DB는 ① `20260715120000_scope_closure_constraints`가 `missing U011 control row`로, 그 다음 ② `20260715210000_harden_scoped_audit_chain`이 `audit_logs_legacy_scope_unresolved_precondition`으로 멈춘다. 실패 사유는 `_prisma_migrations`의 **`logs` 컬럼**에 들어 있다(`error` 컬럼은 없다). 신규 빈 DB는 앞선 `..._scope_backfill_quarantine` 마이그레이션이 `scope-backfill-control-empty-database` 센티널을 자동으로 넣어 주므로 이 함정을 안 겪는다 — 즉 "새 DB에서는 되는데 내 DB에서만 안 되는" 형태로 나타난다. 복구 순서: `pnpm --filter @sangfor/db db:seed`(테넌트·회사 생성 + 프로젝트에 `company_id` 명시 부여) → `scope:backfill` dry-run으로 결정 대상 0건 확인 → `APPLY=1 SCOPE_REVIEW_FILE=<검토파일>`로 제어 행 기록 → `prisma migrate resolve --rolled-back <실패마이그레이션>` → `migrate deploy`. `audit_logs`가 걸리면 그 행들의 `resource_type`을 확인한다 — 마이그레이션의 스코프 유도 규칙은 tenant/company/opportunity만 다루므로 `module_registry` 같은 시스템 레벨 리소스는 **구조적으로 해결 불가**라 보존 후 제거하는 것 외에 방법이 없다. 마무리는 `scope:validate`가 `ok:true`인지로 확인한다.
- **CI_INTEGRATION 테스트는 폐기 가능한 DB를 요구한다**: `packages/business/src/test/setup.ts`의 `assertDisposableDatabase`가 `sangfor_os`를 운영 후보 이름으로 보고 차단하므로, `DATABASE_URL`을 그대로 두면 통합 테스트가 전부 실패한다. 별도 DB(`sangfor_os_test`)를 만들어 마이그레이션·시드를 적용한 뒤 `CI_INTEGRATION=1 DATABASE_URL=postgresql://sangfor:sangfor_password@localhost:5434/sangfor_os_test`로 돌린다.
- **`USER_JWT_*` 키링 미설정 시 apps/web 세션 스위트가 무더기로 깨진다**: 루트 `.env`(gitignored)에 키링이 없으면 `USER_JWT config: USER_JWT_ACTIVE_KID is required`로 40건 이상이 실패하고 `/api/*` 세션 검증도 비활성화된다. 회귀가 아니라 환경 미설정이다 — 생성 원라이너는 `.env.example`의 `USER_JWT_*` 블록 주석에 있다. 모든 값이 `packages/config/src/user-jwt.ts`와 **바이트 일치**해야 하므로(TTL은 28800) 임의 값을 넣으면 `must byte-match`로 거부된다.

---

## 9. 후속 작업 (백로그)

- [x] ~~`runDomainPipeline` 기본 generator를 `createDefaultDomainGenerator`로 디폴트화~~ (2026-06-29, `bc37df1`: `generate` 선택화 + `resolveDomainGenerator`).
- [ ] 실 임베딩 키 설정 후 백필 재실행(recall 품질↑).
- [x] ~~도메인 구조화 산출물 → 실제 DB 레코드(Opportunity/Quote/Invoice) 매핑~~ (2026-06-29, `0c82a31`: `domain-persistence.ts`, runtime `persist` 주입).
- [x] ~~도메인 대시보드 실시간(SSE) 갱신, 카드 상세화~~ (2026-06-29, `edeb114`: SSE 스트림 + outcomeBreakdown/recentDecisions 카드).
- [x] ~~현재 워킹트리 정리~~ (2026-06-29 완료: origin/main 동기화 → `dev-clean`, 손상본 `backup/worktree-thrashing-2026-06-29`에 백업).
- [ ] 불필요한 stale 워크트리 정리(`git worktree remove`) — 특히 `.worktrees/opportunity-to-engagement`가 stale main을 점유.
- [x] ~~CFO ledger 테마를 나머지 CFO 페이지로 확장~~ (2026-06-29, `08e7550`: crud-table·page-heading·loading/error·뱃지). 후속: projects/vat/subscriptions의 read-only 요약 테이블 내부(zinc) + 포털 전역까지.
- [ ] 재무 Postgres RLS(비소유 롤+테넌트 컨텍스트) 세분 통제, pg_dump 전체 백업 cron.
- [ ] workflow console(3500) 컨테이너화(현 `file:` 의존성으로 보류).
- [x] ~~기존 아티팩트명 후보 소급 정리~~ (2026-07-10, `packages/business/scripts/suppress-artifact-candidates.ts`): 원 95건 중 90건은 §9-2 재검증 배치가 자체적으로 `reject`로 이미 전환, 남은 proposed 2건("Customer: Example" ×2)은 스크립트로 `knowledge_only` 전환 완료.
- [x] ~~아티팩트명 Customer 레코드 4건 정리~~ (2026-07-10, 사용자 승인): 백업(`.agents/results/backups/2026-07-10-artifact-customers-backup.json` + activity-logs 백업) 후 `customers` 4건 삭제(activity_logs cascade), 관련 `mail_derived_candidates` 4건의 댕글링 `created_entity_id`를 정리하고 `status=rejected`로 되돌림.
- [x] ~~FinanceProject "인카금융그룹" 매핑~~ (2026-07-10, 사용자 확정): "인카금융서비스 - Sangfor 도입"(`cmr6cdpec00039k2ywm2ijbmq`)으로 통합. Cashflow+1/Expense+1 연결, 합계 27/229(11.8%)→29/229(12.7%).
- [ ] **FinanceProject "게임조선 HCI Renewal" 매핑 확인**(2026-07-08 M1-3에서 보류): 후보 Engagement가 모호(조선일로JNS 계열 여부 불확실)해 오매핑 방지 차원에서 null 유지. 회사 관계 확인 후 `packages/db/scripts/fp-engagement-map.json` 갱신 + `APPLY=1`로 재실행 필요.
- [x] ~~9router 모델을 cx/gpt-5.4-mini → Free-Tier로 전환~~ (2026-07-10, 사용자 지시): `cx` 쿼터 미회복으로 dev root·main-fork `.env`의 `OPENAI_MODEL`을 `Free-Tier`(owned_by=combo, 내부 `gpt-oss:120b`)로 교체, `OPENAI_REVIEW_MODEL`은 미변경. main-fork restart(재빌드 불필요) 헬스체크 통과.
- [ ] **MCP 브릿지(:3600) 미기동 — 커맨드바 에이전트 E2E 막힘**(2026-07-10 발견): `/api/agent/run`이 `runMcpAgent`→MCP 브릿지 fetch 단계에서 실패(`TypeError: fetch failed`) — 9router/LLM 경로 자체는 정상(직접 curl 200 확인), MCP 서비스 스택(`make up`)을 이번 세션에 안 띄워서 발생. `make up`으로 3400/3500/3502/3600 올린 뒤 재확인 필요.
- [x] ~~재검증 데일리 배치·KPI 주간 스케줄 launchd 등록~~ (2026-07-10, 사용자 승인): `~/Library/LaunchAgents/`에 설치 + `launchctl load` 완료(`launchctl list | grep sangfor`로 확인). 3일 연속 실행 확인은 2026-07-13 이후 재점검.

---

## 10. 관련 문서 지도

| 주제 | 문서 |
|---|---|
| 도메인 축 | `docs/13_COLOR_AGENT_ORG/Domain_Axis_Project_Report.md`, `Worklog_2026-06-28_Domain_Axis.md` |
| 컬러 에이전트 | `docs/13_COLOR_AGENT_ORG/Color_*.md`, `SANGFOR_Color_Mapping.md` |
| CFO | `docs/08_IMPLEMENTATION/cfo-2026-06-28-worklog.md`, `cfo-stabilization-and-enhancement-plan.md`, `docs/12_VERIFICATION/cfo-runbook.md` |
| MCP 런타임 | `docs/plans/reproducibility-and-config-durability-plan.md`, `mcp-runtime-reproducibility-report.md` |
| Engagement 전환 | `docs/plans/opportunity-to-project-conversion.md` |
| 메일 하드닝 | `docs/12_VERIFICATION/real-mail-hardening-runbook.md` |
| 검증 매트릭스 | `docs/12_VERIFICATION/verification-command-matrix.md`, `unsafe-action-matrix.md` |
| Requirement/acceptance registry | `docs/01_SPEC/Requirement_ID_Registry.md`, `docs/12_VERIFICATION/acceptance-manifest.json`, `acceptance-evidence.schema.json`, `test-alias-map.json` |
| 에이전트 메모리 | `memory/` (AGENTS.memory.md 계약), `MEMORY.md`(자동 메모리) |

---

## 변경 이력
- **2026-08-09 (Domain-AI 임베더 실사용 배선 + dev 환경 복구)**: 임베더·하이브리드 시맨틱 recall은 구현·테스트가 끝나 있었지만 **프로덕션 호출처가 0개**였다 — 런타임 recall(`runDomainStage`)과 제안서 recall(`generateDomainProposal`)은 태그 전용이었고, 메모리 쓰기 경로는 임베딩을 저장하지 않아 백필 스크립트만이 사후 계산하고 있었다. 세 경로를 `resolveEmbedder()` 주입 하이브리드로 전환하고(임베더 실패·오프라인이면 태그 전용으로 저하, 도메인 격리·negative 억제·top-K 보존), 학습 upsert와 `recordHumanDecision` 쓰기에 best-effort 임베딩을 붙였다(실패해도 쓰기는 막지 않는다). `hybridScore`에는 레코드 단위 차원 가드를 넣어 hash 256과 openai 1536이 섞여도 해당 행이 태그 점수를 온전히 유지하게 했다. 리뷰 4세대를 거치며 실제 결함 넷을 잡았다: `safeEmbed`가 실패 증거 없이 에러를 삼키던 것, 임베딩 HTTP 호출에 마감이 없어 멈춘 엔드포인트가 recall·쓰기를 붙잡을 수 있던 것(`AbortSignal.timeout`, 기본 10초, 양쪽 리졸버 분기에 전달), `recallSemanticFromDb`가 `domain:` 태그를 중복시켜 tagScore 분모를 부풀리던 것, 그리고 `[]`가 JS에서 truthy라 **빈 임베딩을 넘기면 이미 쌓인 벡터가 지워지던** 것. 검증은 실 Postgres 왕복 스모크(`packages/business/scripts/smoke-embedder-wiring.ts`)와 red-team 스위트(`src/domain-ai/__qa__/`: 차원 불일치·임베더 다운·negative 오염·도메인 격리·빈 벡터 wipe·타임아웃·헤르메티시티)로 했다. 같은 세션에서 dev 환경 두 건도 닫았다: ① 로컬 `sangfor_os`가 테넌시 이전 데이터 때문에 72개 중 41개에서 멈춰 있던 것을 시드 → 백필 제어 행 → resolve → deploy로 복구(72/72, `scope:validate` ok, `domain_memories` 474행 보존; 스코프 불가한 `module_registry` 감사 28행은 `.local-backups/`에 보존 후 제거) ② `.env.example`의 `DATABASE_URL`이 존재하지 않는 롤 `ai_portal`을, `USER_JWT_TTL_SECONDS`가 폐기된 900을 가리켜 예시를 복사하면 반드시 실패하던 것을 실측 후 정정하고 로컬 키링 생성 원라이너를 문서화했다(§8). 리뷰 지적 10건의 원문과 처분은 `artifacts/g001-critic-caveats.md`.
- **2026-08-01 (MFA 확립 경로 구현)**: 모든 특권 경로가 `auth_sessions.mfa_verified_at`을 읽는데 **쓰는 코드가 하나도 없었다** — 강제는 완비·테스트까지 돼 있고 확립 수단만 없어서 privileged 라우트 31개(승인 결재·역할 변경·재무 쓰기·제한 데이터 내보내기)를 무인 크론뿐 아니라 사람도 못 썼다(운영 세션 40개 중 MFA 보유 0). RFC 6238 TOTP를 `node:crypto`로 직접 구현했다(레포가 이미 scrypt·HMAC를 손수 구현하는 하우스 스타일이고, 제2인증에 의존성 공급망을 물리지 않기 위함) — RFC 공식 SHA-1 벡터 6개 전부 재현. 명시할 두 성질: ① **재사용 방지** — TOTP 코드는 30초 스텝 내내 유효하므로 한 번 관찰된 코드는 만료까지 재사용 가능하다. `totp_last_counter` 원장을 두어 검증이 매칭된 counter를 돌려주고 그 값이 엄격히 증가해야만 통과시키며, counter 전진과 세션 스탬프를 한 트랜잭션의 CAS로 묶어 같은 코드로 경쟁하는 두 요청이 모두 성공할 수 없게 했다. ② **저장 봉인** — 시크릿은 검증을 위해 복원 가능해야 해서 평문이면 덤프 한 번이 영구 2FA 우회가 된다(옆의 scrypt 다이제스트가 바로 그걸 막으려 존재하고, 어젯밤 야간 논리 백업을 자동화한 지금은 가설이 아니다). AES-256-GCM으로 봉인하며 키는 세션 JWT 키링 파생이 아닌 전용 env(`MFA_TOTP_KEY`)다 — 키링은 회전·폐기되지만 등록된 factor는 그보다 오래 살아야 한다. 키가 없으면 `MFA_NOT_CONFIGURED`로 기능만 닫히고 특권 라우트는 종전대로 막히므로 미설정이 아무것도 깨뜨리지 않는다. 등록은 일반 세션으로 하되(MFA 확립에 MFA를 요구하면 도달 불가) **살아 있는 factor의 교체는 거부**해 탈취된 쿠키로 제2인증을 바꿔치기할 수 없다. `evaluateSession`이 평가한 세션 id를 반환하도록 해 세션 상태를 바꾸는 호출자가 정확히 검증한 그 세션에만 작용하게 했다. 검증: 알고리즘 15케이스·봉인 9케이스, 그리고 실 PostgreSQL에 실제 마이그레이션을 적용해 11단계 흐름(등록 전 거부·봉인 저장·미확인 factor 거부·오답 미확정·확정 코드 소진·제시 세션에만 스탬프·재사용 거부·타 시크릿 거부·재등록 거부·제거 후 잔재 0)을 실증했고 release-gate root lane에 등록했다. 상세는 PR #178.
- **2026-08-01 (컷오버 체인 실태 재확인)**: 앞선 "미배포/미구성" 진단 두 건이 더 **틀렸음**을 확인했다. `/etc/sangfor-os/production-authority.json`은 이미 실제 `approvalIssuer`(`sangfor.production-approval`)와 실제 Worker URL(`https://production-nonce-authority.jm-park.workers.dev/...`)을 담고 있었고, nonce authority Cloudflare Worker도 2026-07-29T08:07:47Z에 이미 배포돼 명세대로 응답한다(consume 경로 GET 405 · 무인증 POST 401 · `/` 404). 근본 원인은 동일하다 — root 0700 파일을 못 읽고 추정했다. 런북이 컷오버 전 **필수**로 규정한 카나리 운영 증명(최초 201 + 에코, 동일 재전송 409)은 도구가 없어 한 번도 수행된 적이 없었으므로 `scripts/nonce-authority-canary.mjs`를 만들어 실행했고 `{"firstStatus":201,"replayStatus":409}`로 통과했다(PR #179). 스크립트는 authority를 스스로 읽어 베어러 토큰이 argv·환경·로그에 남지 않게 하고, 카나리는 전부 0인 candidate SHA와 `canary` 접두 nonce라 소비된 행이 영구히 드릴로 식별된다. **정식 배포에 남은 것은 둘뿐**: ① 배포할 candidate에 대한 U076 인수 캠페인 재실행(`run-detached-release-mirror.mjs --mode u076-final-aliases`, 기존 산출물 2건은 구 SHA용이고 nonce gate 해시 이전 형식) ② AC-DOD-09 외부 승인 receipt — 이는 릴리스 오너의 Ed25519 개인키 서명이 필요한 **사람의 승인 그 자체**라 에이전트가 대신할 수 없다. 인수 캠페인은 약 1.5시간 소요되고 실행 내내 깨끗한 트리와 최종 candidate 고정을 요구하므로, 릴리스를 실제로 끊기로 결정한 시점에 돌려야 한다.
- **2026-08-01 (배포 서명 실태 정정)**: "이 호스트에 배포 서명키가 없다"는 앞선 기록은 **오진이었다**. `/etc/sangfor-os/`가 0700 root라 비root `ls`의 권한 거부를 `2>/dev/null`이 삼켰고, 그걸 "디렉터리 없음"으로 읽었다. 실제로는 2026-07-29부터 authority와 개인키가 설치돼 있었고 `sudo node scripts/production-deployment-receipt.mjs preflight`가 `{"ok":true,"keyId":"deployment-host-2026-07"}`로 통과한다. 오진 위에서 새 Ed25519 2쌍을 만들었으나 기존 `2026-07` 키와 경쟁하면 그 키로 서명된 receipt가 검증 실패하므로 전부 덮어쓰고 삭제했다. **receipt가 없는 진짜 이유**: 현 배포(`fcdb273`, 컨테이너 2026-07-31T11:55:51Z 생성)가 커밋 5분 뒤 `docker build` + `compose up -d`로 수동 기동돼 `deploy-production.sh`를 아예 거치지 않았다. 그 결과 receipt의 유일한 소비자인 `rollback-production.sh`가 쓸 입력이 없어 **현 배포는 롤백 불가**다. 정식 경로 복귀에 남은 것은 서명키가 아니라 ① U076 final acceptance JSON ② `nonce-authority-release-gate.json` ③ AC-DOD-09 외부 승인 receipt다. (같은 날 재확인: ④로 적었던 원격 nonce authority는 **이미 배포돼 있었고** 카나리 201/409로 실증했다 — 바로 위 항목 참조.) 부수적으로 `production-migration-upgrade.test.mjs`가 `docker rm -f`에 `-v`를 빠뜨려 실행마다 39MB 익명 볼륨을 남기던 것을 고쳤다(하루 저녁 7개·270MB 실측 후 제거, PR #176).
- **2026-07-31 (백업 자동화)**: 복구가 증명돼도 아무도 뜨지 않은 데이터에는 소용이 없다는 공백을 닫았다. 이 호스트의 백업은 손으로 뜬 1개뿐이었고 실메일 하루치가 약 17시간 무백업으로 있었으며, 워치독의 신선도 검사를 만족시킬 주체가 호스트에 없었다. `scripts/production-backup.mjs`를 추가해 매일 03:10(워치독 26h 임계 안쪽)에 논리 덤프를 뜨고, `.partial` 이름으로 써서 중단이 짧은 파일을 보호물처럼 남기지 못하게 하며, 타당성 하한 미달을 거부하고 — 파일이 아니라 백업이 되게 하는 부분 — `pg_restore --list`로 되읽어 TABLE DATA 항목이 있을 때만 보관한다(pg_restore는 stdin 덤프를 못 읽으므로 컨테이너 내부 파일로 검증). 각 덤프 옆에 sha256을 쓴다. 보존은 14일이되 5개 미만으로는 절대 지우지 않아 며칠 결측이 디렉터리를 비우지 못한다 — 이 규칙은 창·하한·둘이 동시에 걸릴 때 살아남는 사본·순서 무관성을 7케이스로 덮은 순수 함수다. `run-cron.sh`가 이미 스크립트를 인자로 받으므로 생성기에 `dailyAt`만 추가했고, 생성기 테스트는 이제 엔드포인트 인자를 잡 이름이 아니라 스크립트 종류로 판정해 로컬 스크립트에 `--path`가 새어들면 실패한다. 라이브 스택 실검증: launchd 잡으로 exit 0, `verified 200 table-data entries`, 4.1MB 덤프+체크섬, `.partial` 잔존 0, 7잡 순차 전부 exit 0. 상세는 PR #174.
- **2026-07-31 (운영 관측·복구 실증)**: 실운영이라 부르기 전에 비어 있던 두 가지를 닫았다. ① **복구 실증** — U009 정식 드릴을 런북 한 줄 명령대로 실행해 `result: PASS`(dump·restore·schema·tableCount·contentHash·sequence·constraint·migrationIdempotency·rpo·rto 전부 PASS, RPO 683ms / RTO 12.2s, 양측 잔존 자원 0)를 얻었다. 이 과정에서 런북을 정독하기 전에 실 프로덕션 덤프를 임시 컨테이너에 복원해 확인한 것은 런북이 금지하는 입력(사용자 백업 보관소·임의 절대경로)이자 별도 승인이 필요한 실 아티팩트 드릴이었다 — 결과 자체는 유효했으나(데이터는 정확히 복원, 다만 RLS 정책은 롤이 클러스터 객체여서 사전 생성 필요) 경로가 틀렸으므로 컨테이너와 프로덕션 사본 110MB 익명 볼륨을 제거하고 당일 dangling 볼륨 0을 확인했다. ② **장애 인지** — `scripts/production-watchdog.mjs`를 추가해 컨테이너 5개(healthcheck 미선언인 caddy는 `none` 허용)·엔드포인트 잡 5개 종료코드·Caddy 인그레스·백업 신선도·메일 유입 정지를 :08/:23/:38/:53에 점검하고, 발견 시 상태 파일·macOS 알림·비영 종료코드로 알린다. Telegram/Slack은 변수 설정 시 자동 사용되며 현재 미설정이라 **알림은 이 호스트에만 도달**한다. 규칙은 순수 `evaluateHealth`로 분리해 15케이스로 검증했고, 실제로 redis를 정지시켜 워치독 잡이 exit 1 + `container/redis: not running (exited)`를 내고 복구 후 exit 0으로 돌아오는 것을 실측했다. 워치독을 일정에 넣기 위해 `run-cron.sh`가 실행할 스크립트를 첫 인자로 받도록 일반화해 엔드포인트 잡과 워치독이 PATH·Node 해석을 공유한다. root unit lane 25케이스 통과. **남은 것**: 실행 중인 것에 서명된 배포 receipt가 없다 — 운영자 결정 사항. (2026-08-01 정정: 원인을 서명키 부재로 적었으나 **틀렸다**. `/etc/sangfor-os/`에 2026-07-29부터 `deployment-host-2026-07` 키가 설치돼 있었고 root preflight가 `ok:true`로 통과한다. receipt가 없는 실제 이유는 현 배포가 `deploy-production.sh`를 거치지 않고 커밋 5분 뒤 `docker build` + `compose up -d`로 손수 올려졌기 때문이다.) 상세는 PR #171.
- **2026-07-31 (실운영 전환)**: Outlook 위임 동의를 완료해 메일이 실제로 흐르기 시작했고(계정 1·메시지 1330·스레드 705·후보 1202), 그 과정에서 파이프라인과 기록이 어긋나 있던 지점들을 닫았다. `mail-classify`가 읽는 `mail_insight_threads`에 쓰는 건 `/api/mail-learn`뿐인데 이를 호출하는 크론이 없어 세 잡 모두 성공을 보고하면서 후보가 0건이었다 — `mail-learn`을 :03/:33에 넣어 sync(:00/:30) → learn → classify(:05) 순서를 세웠다. `.agents/launchd/`의 추적 사본은 여전히 `localhost:3101`을 호출했고 템플릿 7개는 echo만 하는 no-op 러너를 가리켜, 레포에서 재설치하면 장애가 재현되는 상태였다. `scripts/launchd/render-launchd-plists.mjs`를 실제 생성기로 구현해 설치본과 추적 사본을 같은 목록에서 렌더링하도록 하고(스텁·템플릿·폐기된 revalidate-batch 제거), 그 테스트를 release-gate root lane에 등록했다(lane 121→128). OAuth 콜백은 `request.url`(컨테이너 `0.0.0.0`) 기준으로 리디렉트해 성공한 연결을 실패처럼 보이게 하던 것을 `NEXT_PUBLIC_APP_URL` 기준으로 고쳤다. Hometax 세금계산서는 특권 재무 쓰기라 신선한 MFA를 요구하므로 무인 크론에서는 거부되는 것이 정상인데 이를 `failed`로 집계해 매회 16건 오류처럼 보였다 — `unauthorized`로 분리하고 배치당 1회만 로깅한다. 이때 request-scoped 재무 호출자를 주입해 200을 받게 만든 시도는, 합성 `NextRequest`가 프록시를 건너뛰어 `INTERNAL_CONTEXT_HEADER` 부재로 `assertBusinessCapability`가 no-op이 되는 **MFA 우회**임을 확인하고 되돌렸다(동일 요청이 Caddy 경유 403, in-process 200). `boot-stack`이 로그인 시 main-fork prod-local을 함께 띄워 :3200을 두고 dev api와 다투고 워크트리 이동 후 고아 프로세스로 남던 것도 제거했다. 재부팅 복귀는 Docker 기동 → `restart: unless-stopped`로 production 컨테이너 자동 복원이며 launchd 5잡은 `~/Library/LaunchAgents`에 상주한다. 상세는 PR #166~#169.
- **2026-07-31**: 운영 자동화 루프 복구 + 배포 입력 재건 — launchd 4잡이 전부 `localhost:3101`을 직접 호출해 실패하고 있었다(production compose는 web/api를 `expose`만 하므로 Caddy :80/:443이 유일 입구). Caddy 경유만으로는 부족해 proxy의 DB-backed 세션과 `projectSlug` 클레임까지 필요했고, `scripts/launchd/cron-call.mjs`가 컨테이너의 active USER_JWT 키링으로 단기 운영자 세션을 서명하고 `cron-session-operator` 한 행만 갱신해 호출하도록 했다(호출마다 `auth_sessions` 행이 쌓이던 누수 차단). 배포 시 사용한 `.env.production`이 `.local-prod` 회수와 함께 소실돼 재배포가 불가능한 상태였던 것을 `scripts/reconstruct-production-env.mjs`로 실행 컨테이너에서 되읽어 재건했다(`deploy-production.sh --check` ok=true / 31 required / 9 services). Outlook은 compose가 `OUTLOOK_*`를 아예 전달하지 않았고, 자격증명 연결 후에는 `fetchMessages`가 Graph 400 응답 본문에서 `value`를 읽어 `{"success":true,"synced":0}`로 위장 성공을 보고하던 결함이 드러나 실패를 그대로 올리도록 고쳤다. 첫 동의에 `Calendars.Read`를 포함시켜(`syncCalendarMeetings`가 이를 요구) 재동의를 피했다. 남은 단계는 포털에서의 위임 OAuth 동의 1회다. 상세는 PR #166.
- **2026-07-28**: 단일 호스트 운영 배포 경로 정식화 — production Compose, owner-only env 검증기, 정식 migration과 RLS app-role credential 초기화, API/Web health gate, Caddy TLS ingress, 명시적 배포 확인을 추가했다. 격리 신규 DB에서 69 migration과 API/Web production health를 실검증하고 테스트 볼륨/네트워크를 제거했다.
- **2026-07-28**: U076 실사용 QA 하네스 운영 안전성 보강 — 고정 `:3101`과 타 프로세스 READY 오인을 제거하고 run-id별 fresh evidence, 명시/동적 loopback 포트 검증, owned web child 생존 검사를 추가했다. 가상 메일 시드는 U076 task-owned loopback `sangfor_task_*` DB와 open/migrated PostgreSQL receipt가 일치할 때만 Prisma를 지연 로드해 mutation하며, 두 행동 테스트를 CI·release manifest·최종 수용성 focused gate에 연결했다.
- **2026-07-27**: U076 100건 격리 실사용 검증 — 이메일 학습 50건과 사용자 UI 입력 50건을 실제 입력해 메일 스레드 50·후보 130·직접 고객 50을 확인하고 승인/반려/AI 재검증/유형교정/연결 산출물을 표본 실측했다. CAS·멱등성·RLS·감사 JSON·회사명 도출·연결 UI 결함을 수정하고 비스코프 레거시 배치/거부/유형수정 경로를 제거했다. 테스트 행·JWT 픽스처·격리 Docker 자원은 모두 삭제했으며 Grok 독립 감사와 Node 20 전체 품질 게이트가 PASS했다. 상세 범위와 과장 금지 경계는 [`docs/plans/2026-07-27-u076-real-use-100.md`](plans/2026-07-27-u076-real-use-100.md)에 기록했다.
- **2026-07-26**: U068/U073/U074 DB closure 보강 — scheduler 실통합 테스트, 198-model 중 187 scoped table의 FORCE RLS와 94개 CHILD_VIA_FK parent-EXISTS 정책, U009 격리 tenant-selective restore 실행기(식별자 allowlist·결정적 remap·hash 기반 멱등성)를 추가했다. 복구 멱등 ledger로 `_prisma_migrations`를 사용하지 않는다.
- **2026-07-25**: AI 품질 커널 (U054) 안착 — policyKey/slot/quorum 규격, writer/lookup 커맨드, 409 에러 코드, user separation 규칙 및 qualityPassed ≠ 승인/발송 구분 명시.
- **2026-07-17**: Canonical requirement/acceptance registry 동결 — 28 requirements, 71 acceptance, 99-row owner/closure manifest, evidence schema, 23-alias/63-step execution map, exact-set validator를 연결하고 C1–C5/W1–W5 제외 범위를 명시했다.
- **2026-06-29**: 최초 작성. 2026-06-28 7개 워크스트림(A 도메인 / B CFO / C MCP / D Engagement / E 웹LLM / F 메일 / G DB마이그레이션) 일괄 정리.
- **2026-06-29**: 워킹트리 thrashing 손상 치유 — `origin/main`(99c69e9) 동기화 → 작업 브랜치 `dev-clean`, 손상본 `backup/worktree-thrashing-2026-06-29` 백업. thrashing 근원(동시 워크트리) 규명·기록(§8).
- **2026-06-29**: 후속 개발 4종(브랜치 `feat-domain-followups`): D 기본 생성기 디폴트화(`bc37df1`) · A 구조화→실 DB 매핑(`0c82a31`) · B 대시보드 SSE+상세(`edeb114`) · C CFO ledger 테마 확장(`08e7550`). 전부 TDD/typecheck/lint 통과, B는 실 DB 검증.
- **2026-06-29**: CFO 세금계산서 자동 처리 (§3.H, PR #38). 홈택스 보안메일 자체 복호화(SEED/AES, 키=MD5(사업자번호)) → 매입 완전 자동 + 발행. 31/31 테스트, 정식 마이그레이션 동봉(도메인 테이블 baseline 포함 — feat-domain-followups의 db-push 부채 해소). 메모 [db push not migrate]는 CI=migrate deploy에 맞춰 갱신됨.
- **2026-07-03**: Phase 8 — CI static-checks 통합, services CI 신설, env example 정비.
- **2026-07-04**: 문서 드리프트 교정(oma-docs verify 기반) — 없어진 패키지 참조 제거(finance/security/application/cache/proxy-core), §2 패키지 목록을 실제 12개로 정정, outlook-graph.ts 이동 경로(→`packages/business/src/mail/outlook`) 반영. AGENTS.md 하네스(루트+경계 14개) + `docs/CODE-REVIEW.md` 신설.
- **2026-07-07**: 컬러게이트 능동 루프(계획서 `2026-07-04-color-gate-active-loop.md`) **라이브 검증** — 접지(메일 타임라인 20건 집약)·재작업 루프·정직한 에스컬레이션·무환각("확인 필요" 표기) 작동 확인. 1차 실행은 게이트 통과 0/3(정직한 에스컬레이션만). 리포트 `.agents/results/replay-doc-quality-verification-2026-07-07.md`. 러너 전제 취약(tsx 미설치 + `@sangfor/shared` dist stale로 `sanitizeJsonStrings` 누락 → shared 재빌드로 해소).
- **2026-07-07**: **게이트 정직성 캘리브레이션**(`color-gate-llm.ts` 프롬프트만) — 원인: `gray`/`orange`가 정직한 "확인 필요"를 미완결로 감점 → 정직성과 통과가 충돌. 수정: 기준을 "출판본"→"사람 검토로 넘길 AI 초안"으로 재프레이밍 + 정직성 규칙(컨텍스트에 없는 값의 명시적 "확인 필요"는 감점 아님; 환각·있는데 회피·논리모순·알맹이부재만 감점). 결과: 동일 인카 본문 재판정 0→5렌즈 PASS(격리 A/B), full 재실행 3/3 통과·승격(`generated_documents` 7→10, status=approved), 껍데기 제안서는 여전히 5렌즈 FAIL(anti-gaming 생존), 도메인-AI 98테스트 무회귀. 임계값·코드 로직 불변(사용자 승인 Approach A). 브랜치 `fix/color-gate-calibration`.
- **2026-07-07**: **WP-A 잔여 완결**(마스터플랜 01) — A-2 `proposal-promote.test.ts`(CI_INTEGRATION 통합 3케이스, 승격 문서/버전/템플릿 upsert/null-체인, IT_PROMOTE_ 태그 정리) 통과. A-3 프로젝트 허브 `LaneDecisionControls`에 승인→승격문서 brass 링크(`/proposals/[id]`, documentId 있을 때만). 같은 브랜치. 타입체크 business·web 모두 클린(A-2 test + A-3 컴포넌트 포함), 변경 파일 2개 lint 클린. **미완**: A-3 브라우저 실드라이브(dev 서버 필요), A-4 PR 출하(push 승인 대기).
  - ⚠️ **로컬 함정 2종(게이트 아님, CI 무관)**: ① 오래된 `apps/web/.next`(gitignore) 생성 타입이 삭제된 페이지(validation/blocks/finance/portal 등)를 참조해 웹 타입체크가 RED로 보임 → `rm -rf apps/web/.next`로 해소(CI는 새로 생성). ② `pnpm install`이 build-script 승인대기(esbuild/sharp)로 **Prisma 클라이언트 생성을 스킵** → `@prisma/client`에 PrismaClient/Prisma export 없음 에러 → `cd packages/db && npx prisma generate`로 복구.
- **2026-07-08/09**: **로드맵 08 §9 인수인계 + M1-W1 완료** — ①이중게이트 12건 배치 승인·전환(오퍼튜니티 12건 생성, `.agents/results/2026-07-08-calib-ops.md`) ②M1-2 main-fork·dev `.env` OPENAI zen/9router 이중정의 정리 + main-fork 재빌드·재기동 ③M1-3 FinanceProject 미매핑 10건 human 매핑(3건 확정연결+7건 null확정, 연결률 8.3%→11.8%·실데이터 상한 명시, `packages/db/scripts/backfill-finance-engagement.ts`에 `--mapping-file` 모드 추가) ④M1-4 상류 아티팩트 필터 TDD(`isArtifactEntityName`, `classify-rules.ts`/`classify-ai.ts`/`candidates-generate.ts`, 기존 정크 95건 발견·백로그 등재) ⑤M1-5 재검증 배치 스크립트 정식화(`packages/business/scripts/revalidate-batch.ts`, cwd 무관하게 고치는 버그 1건 발견·수정) ⑥M1-6 KPI 주간 SQL(`scripts/kpi-weekly.sql/.sh`) 첫 기준선 기록. 전체 품질 게이트(lint/typecheck/test/build) green. §9-2(폴백 529건 재검증)와 M1-2 라이브 확인은 9router `cx/gpt-5.4-mini` 쿼터 429로 세션 내 미완 — 리셋 후 재개 필요(§8 gotcha 참고). launchd 스케줄 등록은 사용자 승인 대기.
- **2026-07-10**: §9-2·§9-3·백로그 마무리. `cx/gpt-5.4-mini` 쿼터가 2일째 미회복(9router 프로세스 자체는 정상, 좀비 워크트리 dev서버 10개 종료해도 무관 — 요청마다 리셋되는 패턴으로 추정) → 사용자 승인 하에 `kr/deepseek-3.2`로 임시 대체. 대체 중 마크다운 코드펜스 JSON 파싱 실패를 발견해 `classify-ai.ts`에 `stripJsonCodeFence()` 근본 수정(모델 무관 방어). 4회 재시도 루프로 폴백 529/529 전량 해소(단, 대체 모델 confidence 캘리브레이션이 원 모델과 달라 이중게이트 통과율 낮음 — cx 회복 후 재검증 권고, `.agents/results/2026-07-08-calib-ops.md` §2). Final Wave 판정 완료, boulder `classifier-calibration-2026-07-07` completed, wp-calib 워크트리 제거(fix는 dev-clean에 이미 반영 확인 후 제거). 백로그 아티팩트 정크 정리: 95건 중 90건은 재검증 배치가 자체 reject, 남은 2건 스크립트로 knowledge_only 전환. 조사 중 2026-07-04 과거 bulk convert가 만든 아티팩트명 Customer 레코드 4건 발견(FK 참조 전수 확인 결과 안전 — 삭제는 사용자 승인 필요, 신규 백로그 항목).
- **2026-07-10 (후속)**: PR #110 CI green 확인 후 squash-merge(`d2d699b`), 로컬 `dev-clean`을 갱신된 `origin/main`(PR #109도 포함)에 동기화. 사용자 승인 5건 일괄 처리 — ①인카금융그룹 FP를 인카금융서비스로 확정 매핑(Cashflow+1/Expense+1, 연결률 11.8%→12.7%) ②재검증 데일리·KPI 주간 launchd 잡 설치+`launchctl load` 완료 ③아티팩트명 Customer 레코드 4건 백업 후 삭제(activity_logs cascade) + 연결된 `mail_derived_candidates` 4건 댕글링 참조 정리 ④9router 모델을 `cx/gpt-5.4-mini`→`Free-Tier`(owned_by=combo, 내부 `gpt-oss:120b`)로 전환, 두 `.env` 갱신 + main-fork 재기동. 라이브 커맨드바(`/api/agent/run`) 왕복 시도 결과 LLM 경로는 정상이나 MCP 브릿지(:3600) 미기동으로 별도 실패 — 신규 backlog.
- **2026-07-10 (W2~W4)**: M1 1차 고도화 마감 — 실측으로 Phase 2·3·4가 이미 머지돼 있음을 확인(로드맵 항목이 낡아 있었음), 실제 잔여만 실행: ①ADR-002 작성(web=BFF 채택, tRPC 도입 폐기, phase-6 문서 배너 — 사용자 승인 대기) ②`dashboard/[role]` prisma 12건을 `role-dashboard-data.ts`로 추출(응답 9종 바이트 동일 검증, 라우트 127→22줄) ③죽은 헬퍼 2종(extractCompanyFromDomain/extractContactFromEmail, 스테일 berlo 라벨) 제거 ④02 게이트 G1~G4+golden+시나리오1 통과 — 재연 중 `mail-candidates-convert.ts` task 분기의 createdEntityId 미설정 실버그 발견·수정·회귀테스트 추가·댕글링 3건 백필(converted 후보 linkage 무결 100%). M1 종료 기준 4/5(잔여: 데일리 배치 3일 연속, 2026-07-13 관측). 증거 `.agents/results/2026-07-10-w2-w4-gate.md`.
- **2026-07-10/11 (M2·M3)**: 피어 협업+Sonnet 서브에이전트로 M2·M3 코드 전량 랜딩(PR #113~#124, 12건). M2: 스파인 수렴 A-0~A-8(우회 writer 0, 라이브 재연 3종 — 재연이 updateOpportunity actor 불일치까지 검출·통일), 파트너 49행, 백업드릴+죽은백업 수정, sales_support 도메인. M3: AutonomyPolicy+autopilot(연속3회 뒤집힘 자동강등)+launchd 파이프라인 4잡 가동+실쿼리 브리핑+와치독+관제화면/kill-switch(DB+env). 정밀도 51→38%는 정크청소 반작용으로 정직 기록. 관찰 대기: 24h 무인 로그·auto 승격(표본 축적 후)·뒤집힘율. 게이트 기록 `.agents/results/2026-07-11-m2-m3-gate.md`.
- **2026-07-07**: **v1 완성 웨이브 — WP-A~E + e2e 6PR(#96~#101) 전부 main 머지 완료**(#101은 2026-07-07T10:44:29Z 머지, `22de4b5`), 상세는 `docs/master-plan/01-development-plan.md` 및 `.agents/results/2026-07-07-*`.
- **2026-07-13**: Claude의 Fable 계열을 Codex 전역 스킬로 이식 — `~/.codex/skills/fable-init`, `fable-agent`, `fable-dispatch`. 실제 Claude 원본은 `fable-agents`(복수)·`fable-dispatch`였으며 별도 `fable-init`은 없어, Codex용 `fable-init`은 내장 init 역할과 Fable 독트린을 결합했다. 세 스킬 구조 검증 통과, dispatch JSONL 원장 정상·오류 경로 실행 검증 완료.
- **2026-07-13 (Fable 지침 감사)**: 루트·하위 에이전트 지침 18개와 1-hop 참조를 감사해 F1–F14 직접 정의/상속 및 링크 무결성을 확인했다. 제거된 tRPC 표면이 현재 구성으로 남아 있던 `AGENTS.md`·`apps/api/AGENTS.md`·`ARCHITECTURE.md`·본 문서의 표현을 Express REST 기준으로 정정했다. Node 20에서 lint·typecheck·build는 exit 0; test는 PostgreSQL `localhost:5434` 미기동으로 17건 실패(71 files/648 tests pass)해 미통과로 기록했다. 새 Codex 세션에서 API 형태와 F6/F13 지침 로드를 재현했다.
- **2026-07-13 (잔여 정리)**: `apps/api/src/middleware/finance-access.ts`의 제거된 tRPC guard 주석을 삭제했다. Codex `SessionStart`/`Stop` 실패는 Claude 전용 `security-guidance` 플러그인이 지원되지 않는 `metrics` JSON을 stdout에 출력한 것이 원인이었다. `claude-plugins-official` 플러그인 16개를 전역·Orca 계정 등록에서 제거했다. 삭제된 훅 경로를 현재 세션이 다시 호출해 발생한 exit 127은 마지막 Stop까지 유효한 호환 래퍼로 차단하고, Stop 직후 남은 Claude 공식 플러그인 캐시도 제거되도록 구성했다. 새 `codex exec`에서는 나머지 활성 훅이 모두 완료되는 것을 확인했다.
- **2026-07-13 (Antigravity 스킬 이식)**: Claude의 Fable 계열 스킬(fable-init, fable-agent, fable-dispatch)을 Antigravity 전역 스킬/플러그인으로 포팅 완료 — `~/.gemini/config/plugins/fable/` 하위에 설치. plugin.json, installed_version.json 및 chmod +x script 설정 검증 완료.
- **2026-07-13 (R11-R15 인계)**: 권한·프로젝트 격리·동시성·AI fallback·반응형 교정과 R15 3-arm 교차검증을 완료했다. 구현 커밋, 검증 수치, QA 원복 상태, 프로덕션 기준선 drift 주의사항과 R16 재개 조건은 [`docs/plans/2026-07-13-r11-r15-claude-handoff.md`](plans/2026-07-13-r11-r15-claude-handoff.md)에 고정했다. 사용자 지시에 따라 R16-R20은 시작하지 않았다.
- **2026-07-13 (R16-R20 실사용 5라운드)**: Sol 실행 + Grok 독립검토로 50개 시나리오를 수행했다. 연락처/파트너/작업 교정·보관 및 tenant 경계, 전환 409/force, 갱신·월마감·VAT 도달성, CFO 수치·계약·오류 진실성, 모바일·한국어·키보드 피드백을 개선했다. 기존 비격리 테스트가 운영 감사 로그 34행을 남기는 문제도 발견해 integration gate로 재발을 차단했으며, 로그 삭제는 승인 대기다. 상세 매트릭스와 잔여 위험은 [`docs/plans/2026-07-13-r16-r20-real-usage-qa.md`](plans/2026-07-13-r16-r20-real-usage-qa.md)에 기록했다.
