# sangfor-os 개발 마스터 참고문서 (Living Reference)

> **목적**: 개발할 때마다 펴보는 단일 진입점. 시스템 지도 · 워크스트림 · 소스 인벤토리 · 명령어 · 데이터모델 · 알려진 이슈를 한 곳에.
> **유지 규칙**: 작업이 끝날 때마다 이 문서를 갱신한다. 새 워크스트림은 §3에 한 섹션 추가, 명령은 §5, 파일은 §6, 모델 변경은 §7, 이슈는 §8. 맨 아래 **변경 이력** 한 줄 추가.
> **최초 작성**: 2026-06-29 (2026-06-28 작업 일괄 정리) · **마지막 갱신**: 2026-06-29

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
  mail-intelligence/, persona/, security/, auth/, cache/, config/, infra/,
  health/, ui/, application/, api-utils/, proxy-core/
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
- **데이터 신뢰성(P0)**: 유실 근본원인 = stale `schema.prisma` + 반복 `db push`로 테이블 drop. → 비파괴 스냅샷/복원(`cfo:snapshot`/`cfo:restore`, 멱등), import footgun 가드(FORCE=1), 마이그레이션 전환(§3.G).
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
- **연동**: Outlook 동기화(`apps/web/.../outlook-graph.ts`) 시 홈택스 메일 자동 인입 + `.html` 수동 업로드 폴백. UI: `cfo/(cfo)/tax-invoices`(매입/매출) + 설정 사업자번호. REST `/api/cfo/tax-invoices`·`/company-settings` + tRPC.
- **테스트**: 단위+통합 31/31(통합은 `CI_INTEGRATION=1`, 공유 DB라 직렬 — `vitest.config.ts fileParallelism`). 서브에이전트 TDD + 최종 전체리뷰 통과.
- **마이그레이션**: §3.G 전환에 맞춰 `db push` 대신 정식 마이그레이션 생성(`migrate diff` + shadow DB). 설계/계획: `docs/superpowers/{specs,plans}/2026-06-29-cfo-tax-invoice-automation*`.

### 3.G DB 마이그레이션 정식 전환 + 스냅샷 안전망 (PR #25, `fb8d5a5`)

- **근본 문제**: `prisma migrate dev`는 파괴적 리셋을 요구 → 메일/재무 데이터 보호 위해 그동안 `db push` 사용. 그러나 stale 스키마 + 반복 push가 테이블 drop을 유발(데이터 유실).
- **전환**: db-push 갭을 baseline 마이그레이션으로 생성, fresh DB에서 `migrate deploy` → schema와 empty-diff 검증. **CI test를 `db:push` → `db:migrate:deploy`** 로 전환.
- **안전망**: `db:push:safe`(스냅샷 후 push), `cfo:snapshot`/`cfo:restore`(비파괴 멱등), 시간별 cron 가이드.
- **규칙**: 스키마 변경 전 반드시 `git diff origin/main -- packages/db/prisma/schema.prisma` 확인. `db push --accept-data-loss` 금지.

> `memory/`의 [DB uses db push not migrate] 메모는 이 전환으로 갱신 필요(현재 마이그레이션 전환 중).

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
pnpm --filter @sangfor/db db:push:safe         # 부득이할 때(스냅샷 후 push)
pnpm --filter @sangfor/db cfo:snapshot         # 비파괴 백업
pnpm --filter @sangfor/db cfo:restore          # 멱등 복원
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
| `mail-candidates.ts` | 메일 후보 분류 + `sanitizeJsonStrings`(toInputJson) + LLM hydration |
| `outlook-sync.ts` | app-only Outlook 동기화(client_credentials) |
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
| `src/lib/outlook-graph.ts` | 위임형 OAuth + Graph 동기화 |
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
| 에이전트 메모리 | `memory/` (AGENTS.memory.md 계약), `MEMORY.md`(자동 메모리) |

---

## 변경 이력
- **2026-06-29**: 최초 작성. 2026-06-28 7개 워크스트림(A 도메인 / B CFO / C MCP / D Engagement / E 웹LLM / F 메일 / G DB마이그레이션) 일괄 정리.
- **2026-06-29**: 워킹트리 thrashing 손상 치유 — `origin/main`(99c69e9) 동기화 → 작업 브랜치 `dev-clean`, 손상본 `backup/worktree-thrashing-2026-06-29` 백업. thrashing 근원(동시 워크트리) 규명·기록(§8).
- **2026-06-29**: 후속 개발 4종(브랜치 `feat-domain-followups`): D 기본 생성기 디폴트화(`bc37df1`) · A 구조화→실 DB 매핑(`0c82a31`) · B 대시보드 SSE+상세(`edeb114`) · C CFO ledger 테마 확장(`08e7550`). 전부 TDD/typecheck/lint 통과, B는 실 DB 검증.
- **2026-06-29**: CFO 세금계산서 자동 처리 (§3.H, PR #38). 홈택스 보안메일 자체 복호화(SEED/AES, 키=MD5(사업자번호)) → 매입 완전 자동 + 발행. 31/31 테스트, 정식 마이그레이션 동봉(도메인 테이블 baseline 포함 — feat-domain-followups의 db-push 부채 해소). 메모 [db push not migrate]는 CI=migrate deploy에 맞춰 갱신됨.
