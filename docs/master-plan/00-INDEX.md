# 베를로 OS 완성 마스터플랜 — 문서 지도 (00)

> **작성일**: 2026-07-04 · **기준 커밋**: `f327c89` (origin/main, PR #94 컬러게이트 백엔드 머지 직후)
> **대상 독자**: 이 저장소를 처음 보는 구현 에이전트. 이 문서 묶음만 읽으면 추가 질문 없이 작업을 시작할 수 있어야 한다.
> **유지 규칙**: 각 문서의 태스크가 완료되면 해당 문서의 체크박스를 갱신하고, 완료 증거(명령+출력)를 `.agents/results/`에 남긴다.

---

## 1. 이 문서 묶음의 목적

베를로 OS(업무자동화 OS, 저장소 `sangfor-os`)를 **완성 → 검증 → 5차에 걸친 고도화**로 이끄는 단일 계획 체계다.
기존에 흩어져 있던 계획(리팩토링 마스터플랜, Phase 2~8 실행 문서, 시스템 정합성 감사, Convergence PLAN, ai-roles 설계)을
**하나의 실행 순서**로 통합하고, 남은 작업을 에이전트가 바로 집행할 수 있는 태스크 단위로 재정의한다.

| # | 파일 | 내용 | 실행 시점 |
|---|---|---|---|
| 00 | `00-INDEX.md` | 이 문서. 지도 + 공통 프로토콜 + 용어집 | 항상 먼저 읽기 |
| 01 | `01-development-plan.md` | **개발계획서** — v1 완성까지 남은 작업 전부 (WP-A~E) | 즉시 |
| 02 | `02-verification-plan.md` | **검증서** — 모든 단계에 공통 적용되는 검증 게이트·증거 규칙 | 01과 병행, 이후 상시 |
| 03 | `03-enhancement-phase-1.md` | **1차 고도화** — 구조 건전화(리팩토링 Phase 2→3→4 완결) | 01 완료 후 |
| 04 | `04-enhancement-phase-2.md` | **2차 고도화** — 결정 스파인 완전 수렴 + AI 역할 재편 | 1차 완료 후 |
| 05 | `05-enhancement-phase-3.md` | **3차 고도화** — 자율운영(자동승인·상시 파이프라인·와치독) | 2차 완료 후 |
| 06 | `06-enhancement-phase-4.md` | **4차 고도화** — 플랫폼 통합(business 재구조화·API 통일·DB·관측성) | 3차 완료 후 |
| 07 | `07-enhancement-phase-5.md` | **5차 고도화** — 지능 고도화(임베딩·RAG·파인튜닝·예측·다크스킨) | 4차 완료 후 |

**의존성 원칙**: 01(완성)이 최우선이다. 03~07은 번호 순서가 기본이지만, 각 문서의 "선행 조건" 절이 실제 게이트다.
02(검증서)는 별도 단계가 아니라 **모든 작업의 종료 조건**이다.

---

## 2. 2026-07-04 현재 상태 스냅샷

구현 에이전트는 아래를 사실로 받아들이고 재검증에 시간을 쓰지 않는다 (단, 착수 시점에 `git log --oneline -5`로 기준 커밋 이후 변화만 확인).

### 제품 상태
- **화면**: `apps/web/src/app` 아래 약 54개 화면. 전부 실데이터 렌더링, 순수 빈 stub 없음. 잔여 플레이스홀더는
  경영 대시보드 AI 어시스턴트 핸들러("준비 중" TODO)와 presales/sales/delivery/operator/security 일부 섹션.
- **API**: web 라우트 약 95개 + `apps/api`(재무 백엔드, `:3200/api/cfo`, web에서 `finance/[...path]` 프록시).
- **DB**: `packages/db/prisma/schema.prisma` 단일 통합 스키마, 약 180 모델. 재무는 `finance_*` 매핑 테이블.
  별도 스키마는 `services/sangfor-engineer-mcp/prisma`(엔지니어 RAG 전용)뿐.
- **테스트**: `packages/business`에 약 68개 테스트 파일. 기준선(2026-07-02): `pnpm lint && typecheck && test && build` 전부 통과.

### 미커밋 작업 (브랜치 `verify-latest`, origin/main 동일 지점)
**"컬러게이트 LLM 검증 + 사람 승인 시 문서 승격"** — 도메인 AI 제안 루프를 닫는 응집 기능. 거의 완성, 미커밋.
- 신규: `packages/business/src/domain-ai/color-gate-llm.ts`(+test), `proposal-promote.ts`
- 수정: `domain-proposal.ts`(+36), `project-decision.ts`(+61), `artifact-domain-map.ts`, `domain-ai/index.ts`, `apps/web/src/app/(portal)/projects/[id]/page.tsx`(+29)
- 남은 일: `proposal-promote` 통합 테스트, 마이그레이션 확인, 커밋/PR → **01 문서 WP-A**

### 리팩토링 트랙 상태 (`docs/plans/2026-07-02-problem-based-refactoring-plan.md`, 25문제 P1~P25 / 9 Phase)
| Phase | 내용 | 상태 |
|---|---|---|
| S | 보안 하드닝(P1~P4) | 마스터플랜 정의됨 — 착수 여부는 코드에서 `apps/web/src/middleware.ts` 존재로 확인 |
| 0 | 안전망(e2e 복구, 특성화 테스트) | ✅ 완료(merged) |
| 1 | 데드코드 제거 | ✅ 완료(PR #84, 6,881줄 삭제) |
| 2 | 중복 제거(dedup) | 🔶 진행 중 — Task 1·5·6 완료 / 2·3·4 잔여 → **03 문서** |
| 3 | web route 레이어링(11 라우트) | ⬜ 대기 → **03 문서** |
| 4 | `mail-candidates.ts` God-file 분해 | ⬜ 대기 → **03 문서** |
| 5 | business 패키지 재구조화(9폴더) | ⬜ 대기 → **06 문서** |
| 6 | API 표면 통일 | ⬜ 대기, **방향 상충 미해결(ADR 필요)** → **03 문서 Task 0 / 06 문서** |
| 7 | DB 인덱스·FK | ⬜ 대기 → **06 문서** |
| 8 | 툴링/CI | ✅ 완료(2026-07-03) |

### 시스템 정합성 감사 (`.agents/results/system-integrity-audit-2026-07-03.md`)
사용자 지적 3건("메뉴 통합 안 됨/데이터 불일치/project_id 미연결") 모두 실재로 확인됨. P0~P3 로드맵 미착수 → **01 문서 WP-B/C/E**.
- 데이터 3개 섬: CRM(고객36·기회37) ↔ 메일 파생후보 약 1,081건(테스트분 227건 정리 후) 대부분 미승인 ↔ 재무 현금흐름 179건 engagement 연결 0.
- `MOCK_PROJECTS` 하드코딩 선택기, DB 실프로젝트는 `demo-project` 1개, `"demo-project"` 하드코딩 18곳(P18).
- "진행중 딜" 수치가 화면마다 26/26/37/20으로 다름. 홈 깔때기 ③⑤⑥ 칸은 enum 미매핑으로 항상 0.

### Convergence 트랙 (`docs/convergence/PLAN.md` v5 FROZEN + ADR-001)
결정 스파인(단일 write path `recordDecision()`) 수렴 자체는 출하됨. **§7 Follow-up register가 전부 이월** → **04 문서**.

### 디자인 (`DESIGN.md` 루트, 방향 A "계기판" 확정 2026-07-04)
계기판 8화면 목업 → my-work 코크핏(PR #92) + 6화면(커밋 `08340ba`) + 재무(`28d96e3`) 구현 완료. 다크(관측소) 스킨은 v2 → **07 문서**.

### 2026-07-07 갱신
01 문서(개발계획서)의 WP-A~E가 전부 완결·머지됐다 — WP-A(#96)·WP-B(#97)·WP-D(#98)·WP-C(#100)·WP-E(#101, 2026-07-07T10:44:29Z 머지 `22de4b5`) **5개 PR 전부 main 반영 완료**. 같은 웨이브에서 CI e2e 잡을 실차단 체크로 승격(#99, `continue-on-error` 제거 + `webServer` 자동 기동). WP-B의 "진행중 딜" 정합(56 across 5 surfaces)과 WP-A의 컬러게이트 승인→문서 승격 루프는 라이브로 재검증됨. 계획 대비 실측과 달랐던 항목(C-2 `demo-project` 잔존 규모, C-3 분류기 신뢰도 상한)과 05/06 문서로 이월된 후속 작업, 그리고 WP-E 전용 증거 파일 부재(검증 근거가 PR #101 본문에만 있음)는 01 문서의 각 태스크 체크박스 옆 주석과 `backlog.md`를 참고 — 잔여 작업은 03~07 문서로 계속된다.

---

## 3. 공통 실행 프로토콜 (모든 문서·모든 태스크에 적용)

### 3.1 환경 기동
```bash
# Node 20 고정 (.nvmrc). pnpm 워크스페이스.
nvm use 20 && corepack enable

# DB/Redis (postgres :5434→5432, redis :6380→6379)
pnpm docker:dev

# 개발 스택 원커맨드 (api :3200 + web :3101, 헬스 대기까지)
scripts/dev-up.sh          # 종료: scripts/dev-down.sh
scripts/dev-smoke.sh       # 핵심 라우트 200/307 스모크

# 실사용(로컬 프로드) 스택 — main-fork에서 :3100(web)/:3210(api)
./prod-local.sh            # 비밀번호 등은 .env에 있음
```
- **워크트리 주의**: 새 git worktree에는 untracked `.env`가 없다. 루트 `.env`와 `packages/db/.env`를 복사하지 않으면
  DB 테스트가 `DATABASE_URL not found`로 실패하며 이는 회귀가 아니다.
- **LLM**: 앱 LLM은 로컬 9router(`http://127.0.0.1:20128`, OAuth-fronted, 제로비용)를 `.env`의 `OPENAI_*` override로 사용.
  생성 모델 `cx/gpt-5.4-mini`, 검증(review) 모델은 `OPENAI_REVIEW_MODEL`(기본 `cx/gpt-5.4-mini-review`).
  9router 미기동 시 LLM 경로는 규칙기반/stub 폴백 — LLM 라이브 검증 전 `curl -s http://127.0.0.1:20128/health` 확인.

### 3.2 브랜치·커밋·PR
- **main 직접 체크아웃 금지**: `main`은 다른 워크트리가 점유 중일 수 있다. 항상 `git fetch origin && git checkout -b <branch> origin/main`.
- **조기 커밋**: 공유 트리 thrashing 이력이 있다. 작업 시작 즉시 전용 브랜치를 만들고 자주 커밋한다.
- 브랜치 이름: `feat/<slug>`, `refactor/<slug>`, `fix/<slug>`. 커밋은 Conventional Commits.
- PR 출하는 한 커맨드: `scripts/round-ship.sh <branch> "<제목>" "<본문>"` (커밋+push+PR+auto-merge squash).
  CI green 시 자동 머지(PostToolUse 훅 `scripts/pr-auto-merge.sh` 병행). CI 관찰은 `gh pr checks --watch` (sleep 폴링 금지).
- **커밋 금지 파일**: `.env*`(특히 `.env.bak.9router`), `apps/web/next-env.d.ts`(자동생성 diff는 버림), 스냅샷/백업류.

### 3.3 품질 게이트 (모든 태스크의 종료 조건 — 상세는 02 검증서)
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # 4종 전부 통과해야 "완료"
CI_INTEGRATION=1 pnpm --filter @sangfor/business test    # DB 의존 통합 테스트 (docker:dev 필요)
```
- **완료 선언 규칙**: 명령을 실제로 실행해 통과 출력을 본 뒤에만 완료라고 말한다. 증거는 `.agents/results/`에 저장.

### 3.4 DB 변경 규칙 (절대 규칙)
- 모든 스키마 변경은 **정식 마이그레이션 파일**(`packages/db/prisma/migrations/`)로. CI는 `migrate deploy`를 실행한다.
- `prisma db push --accept-data-loss` **금지**. 부득이한 push는 `pnpm --filter @sangfor/db db:push:safe`(스냅샷 선행)만.
- 변경 전 필수: `git diff origin/main -- packages/db/prisma/schema.prisma` (stale 스키마로 인한 drop 사고 방지).
- 원칙: **additive/nullable only** (DROP/RENAME/non-null ADD 금지 — Convergence 불변식과 동일).
- 백업: `pnpm --filter @sangfor/db cfo:snapshot` (비파괴·멱등).

### 3.5 구현 위임 (토큰 경제)
- 명세가 명확한 구현은 `opencode-coder` 에이전트(opencode CLI, `-m deepseek/deepseek-v4-flash` 명시)로 위임 가능.
  이 문서 묶음의 태스크 명세는 그 위임이 가능하도록 작성돼 있다. 위임 후 diff·증거를 리뷰어(상위 모델)가 검수한다.
- 기계적 작업(파일 이동, 문서 갱신, 배치 치환)은 chore 급 에이전트로.

### 3.6 데이터 안전
- 실DB에는 실제 메일/재무 데이터가 있다. 파괴적 스크립트(삭제·백필) 실행 전 반드시 `cfo:snapshot` + 대상 건수 SELECT로 확인.
- `project_id='demo'` 오염 주의: 시드/테스트 데이터를 실DB에 만들 때 반드시 테스트 표식(prefix `test-` 또는 전용 project)을 남겨 후처리 삭제가 가능하게 한다.

---

## 4. 용어집 (이 저장소의 고유 개념)

| 용어 | 뜻 |
|---|---|
| **베를로 OS** | 이 제품. Sangfor 한국 영업/엔지니어링 조직의 업무자동화 OS. 철학: human-in-the-loop — AI가 초안, 사람이 결정, 결정이 학습되어 자율도가 올라간다. |
| **종축 도메인(GTM 파이프라인)** | `marketing → sales → presales → engineer → cfo`. 각 도메인은 단독-writer 데이터 소유 경계. `packages/shared/src/modes.ts`의 `GTM_PIPELINE`. |
| **횡축 컬러 렌즈(5색)** | Blue(기술)·Red(리스크)·Orange(가치/마진)·Gray(근거)·Teal(전달명료성). AI 교차 검증 전용 색. 사람(지휘관)은 브라스(brass). |
| **컬러 게이트** | 산출물 검증 관문. 결정형(`color-gate.ts`, 신호 기반) + LLM형(`color-gate-llm.ts`, review 모델 실판정) 2계층. |
| **결정 스파인(decision spine)** | 모든 의사결정 기록의 단일 canonical write path: `recordDecision()` (`packages/business/src/governance/ai-decision.ts`) → `domain_decision_logs`. ADR-001. |
| **DomainMemory / DomainDecisionLog** | 도메인별 학습 메모리(케이스/규칙/예외, recall 대상) / 결정 감사 로그(사람 수정 포함). |
| **Engagement** | 수주 후 프로젝트 워크스페이스(물리 테이블 `delivery_projects`). Opportunity에서 멱등 전환(`opportunityId @unique`). |
| **프로젝트 허브** | `/projects/[id]` — Engagement를 도메인 파이프라인 인스턴스로 보는 통합 뷰(레인 + 제안 + 손익 + 자율도). |
| **메일 파생후보(MailDerivedCandidate)** | 메일에서 추출된 고객/기회/태스크 후보. 승인 큐를 거쳐 실엔티티로 전환된다. |
| **계기판(Instrument) 디자인** | 루트 `DESIGN.md`의 확정 디자인 시스템. "계기는 정직"(가짜 데이터 금지), 5색은 AI 검증 전용, 시그니처 컴포넌트(VerificationConsole 등). |
| **자율도(autonomy)** | `computeAutonomy` — 도메인×프로젝트별 사람-신호 행 기반 자율화 지표. 표본<3이면 "학습중". 3차 고도화에서 자동승인의 근거가 된다. |
| **9router** | 로컬 LLM 게이트웨이(:20128). OpenAI 호환. 앱의 모든 LLM 호출이 여기로 간다(제로비용). |

---

## 5. 기존 문서와의 관계 (충돌 시 우선순위)

1. **이 마스터플랜(00~07)** — 실행 순서·범위의 최종 결정본.
2. 각 Phase 실행 문서(`docs/superpowers/plans/2026-07-03-phase-*.md`) — 03/06 문서가 참조하는 **줄 단위 실행 상세**. 태스크 스텝은 그쪽이 정본.
3. `docs/plans/2026-07-02-problem-based-refactoring-plan.md` — 문제 정의(P1~P25)의 정본.
4. `docs/convergence/PLAN.md`(FROZEN v5) + `ADR-001` — 결정 스파인 불변식의 정본. 위반 금지.
5. `docs/DEV_REFERENCE.md` — 시스템 지도·명령어 정본(살아있는 문서, 작업 후 갱신).
6. `DESIGN.md`(루트) — UI 작업의 단일 디자인 정본.

**알려진 문서 간 상충 2건**(03 문서 Task 0에서 해소):
- Phase 6 방향: 마스터플랜은 "web=BFF, tRPC 표면 제거", phase-6 실행 문서는 "tRPC 신규 도입" — ADR-002로 재확정 필요.
- Phase 7 내용: 마스터플랜(인덱스·FK 승격)과 phase-6 문서 내장 Phase 7(신규 컬럼 추가)이 다름 — ADR-002에 함께 포함.
