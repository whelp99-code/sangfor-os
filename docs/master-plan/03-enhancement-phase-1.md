# 1차 고도화 계획서 — 구조 건전화: 리팩토링 Phase 2→3→4 완결 (03)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 또는 subagent-driven-development. 이 문서는 **오케스트레이션 문서**다 — 각 태스크의 줄 단위 실행 스텝은 이미 검증된 실행 문서(`docs/superpowers/plans/2026-07-03-phase-*.md`)에 있으며, 그 문서가 스텝의 정본이다. 여기서는 순서·상태·완료 기준·상충 해소를 정의한다. 착수 전 `00-INDEX.md` §3 공통 프로토콜 필독.

**Goal:** `packages/business`와 web API 레이어의 구조 부채(P5, P8, P10, P12 중복·God-file·레이어 위반)를 제거해, 이후 고도화(2~5차)가 얹힐 수 있는 건전한 코드베이스를 만든다.

**선행 조건:** 01 개발계획서 WP-A~E 머지 완료 (같은 파일들을 만지므로 순서 역전 금지. 특히 `mail-candidates.ts`는 WP-C가 먼저 사용).

**전역 제약:** 이 차수의 모든 작업은 **행위 보존**이다. Phase 0 golden/특성화 스냅샷이 단 1바이트도 변하면 실패(02 검증서 §1.3). 커밋 타입은 `refactor:`/`chore:`만.

---

## 상태 기준선 (2026-07-04)

| 단계 | 실행 문서 | 상태 |
|---|---|---|
| Phase 2 dedup | `docs/superpowers/plans/2026-07-03-phase-2-dedup.md` | Task 1(통화 포맷터)·5(LLM 설정)·6(대시보드) 완료 / **Task 2·3·4 잔여** |
| Phase 3 레이어링 | `docs/superpowers/plans/2026-07-03-phase-3-layering.md` | 미착수 (Phase 2 머지가 선행) |
| Phase 4 God-file 분해 | `docs/superpowers/plans/2026-07-03-phase-4-god-file-decomposition.md` | 미착수 (Phase 3 머지가 선행) |
| 방향 상충 | Phase 6 (tRPC 제거 vs 도입), Phase 7 내용 | **미해소 — Task 0에서 ADR-002로 결정** |

착수 시 첫 행동: `git log --oneline -20`과 `gh pr list --state merged --limit 10`으로 위 상태가 여전히 사실인지 확인하고, 이 표를 갱신한다.

---

## Task 0: ADR-002 — API 표면 방향 결정 (사람 승인 필요)

**Files:** Create: `docs/convergence/ADR-002-api-surface.md`

**배경:** 마스터 리팩토링 플랜의 Phase 6은 "web=BFF, 실호출자 없는 tRPC business/dashboard/mail 표면 **제거**, CFO는 REST 단일화"인데, 실행 문서 `phase-6-api-unification.md`는 반대로 "tRPC **신규 도입** + OpenAPI 자동생성"으로 쓰여 있다. 둘 다 실행하면 충돌한다. Phase 7도 마스터(인덱스·FK 승격)와 실행 문서(신규 컬럼 `segment`/`riskScore` 추가)가 다르다.

- [ ] **Step 1: 실호출자 조사** — 결정의 근거 데이터 수집:
```bash
grep -rn "trpc" apps/web/src --include='*.tsx' --include='*.ts' -l | head -20   # tRPC 클라이언트 실사용처
grep -rn "api/trpc" apps/web/src | wc -l
```
- [ ] **Step 2: ADR 작성** — 권고 기본값: **마스터 플랜 방향(web=BFF, 미사용 tRPC 표면 제거)을 채택**한다. 근거: P8(API 표면 3중화)의 목적이 표면 축소이고, tRPC 도입은 표면을 늘린다. OpenAPI 문서화는 tRPC 없이 기존 `openapi.json` 라우트 확장으로 달성 가능(06 문서). Step 1 조사에서 tRPC 실사용이 광범위하면 반대 결론도 가능 — 근거와 함께 기록.
- [ ] **Step 3: Phase 7 범위 확정** — 마스터 방향(인덱스 보수 + FK 승격, 개념 통폐합 제외) 채택. 실행 문서의 신규 컬럼(`segment`/`riskScore` 등)은 5차 고도화(07 문서, 예측 분석)의 선행 작업으로 이관.
- [ ] **Step 4: 사용자 승인** — ADR 초안을 사용자에게 제시하고 승인받은 뒤 Status를 Accepted로. **승인 전 Phase 6 계열 작업 착수 금지** (Phase 2~4는 이 결정과 무관하므로 병행 가능).

**Acceptance:** ADR-002 Accepted + `phase-6-api-unification.md` 상단에 "ADR-002로 대체/수정됨" 배너 추가.

---

## Task 1: Phase 2 잔여 완결 (dedup Task 2·3·4)

**실행 정본:** `2026-07-03-phase-2-dedup.md` — 아래는 요지만. 스텝·코드는 정본을 따른다.
**브랜치:** `refactor/phase-2-dedup` (기존 브랜치가 있으면 rebase 후 계속)

- [ ] **Task 2 — 메일 도메인 상수/정규화 단일화**: `packages/business/src/mail-domain-registry.ts`에 `SELF_DOMAINS` 등 + `normalizeEmailDomain`/`isSelfDomain`/`domainRoot`. 사용자 결정 반영: `blro.co.kr` keep / `berlo.co.kr`·`microsoft.com`·`sangforsecurity.com` remove / `bill36524.com`은 `SYSTEM_SENDER_DOMAINS`로. (파일이 이미 존재하면 소비처 치환만 잔여 — `grep -rn "blro.co.kr\|berlo.co.kr" packages apps`로 중복 정의 잔존 확인.)
- [ ] **Task 3 — `sanitizeJsonStrings` 단일화**: `packages/shared/src/sanitize.ts`로 이동, 소비처(메일 저장 경로 전부) 치환. lone surrogate 크래시 방지 기능이므로 특성화 테스트 확인.
- [ ] **Task 4 — Outlook 동기화 통합(최대 항목)**: `apps/web/src/lib/outlook-graph.ts`(위임형) + `packages/business/src/outlook-sync.ts`(app-only)를 `packages/business/src/outlook/`로 통합, `mail-import/route.ts`의 분기 제거, 단일 진입 `syncOutlook()`. 위임형 우선 → app-only 폴백 순서 보존(행위 보존 핵심).
- [ ] **Final PR**: 제목 `refactor: Phase 2 — deduplication (P8, P10, P12)`. 게이트 4종 + golden 무변화 + `CI_INTEGRATION=1` 통과 증거 첨부.

**Acceptance:** 중복 정의 0(각 상수·함수의 정의처가 저장소에서 정확히 1곳), golden 스냅샷 무변화, PR 머지.

---

## Task 2: Phase 3 — web route 레이어링 (11개 라우트, 838줄/prisma 91회 이관)

**실행 정본:** `2026-07-03-phase-3-layering.md` (Task 3-A~3-K).
**브랜치:** `refactor/phase-3-layering`
**선행:** Task 1 머지 + ADR-002의 Nexias 특례 결정(정본 문서의 D2 — 3-F cleanup 라우트 착수 전 필요. 미결정이면 3-F만 뒤로 미루고 나머지 진행).

- [ ] 3-A `actions/[actionKey]/validate` → `packages/business/src/action-validation.ts`
- [ ] 3-B `settings/llm` — 이미 위임됨, no-op 확인만
- [ ] 3-C `policy-memories/[id]` 이관
- [ ] 3-D `domain-pipeline` → `extractDomainPipeline`
- [ ] 3-E `mail-candidates/batch` 이관
- [ ] 3-F `mail-candidates/cleanup` 이관 (+Nexias 특례 결정 반영)
- [ ] 3-G `modules/[moduleKey]/validate` 이관
- [ ] 3-H `mail-insight-threads/generate` 이관
- [ ] 3-I `dashboard/[role]` → Phase 2 Task 6의 `role-dashboard.ts` 재사용 (01 문서 WP-B에서 이 파일에 스테이지 헬퍼가 이미 들어갔는지 확인 — 충돌 시 WP-B 버전이 정본)
- [ ] 3-J `daily-report` 이관
- [ ] 3-K `mail-candidates/convert` 이관 (196줄/prisma 25회 — 최대. golden 스냅샷 최우선 감시 대상)
- [ ] Final PR: `refactor: Phase 3 — extract business logic from web routes (P11)`

**Acceptance:** 11개 라우트가 전부 "auth + parse + business 호출 + serialize" 4역할만 수행(라우트 파일에 prisma 직접 호출 0 — `grep -n "prisma\." apps/web/src/app/api/<각 라우트>` 로 확인). golden 무변화.

---

## Task 3: Phase 4 — `mail-candidates.ts` God-file 분해 (2,276줄 → 5모듈)

**실행 정본:** `2026-07-03-phase-4-god-file-decomposition.md` (Task 4-1~4-5).
**브랜치:** `refactor/phase-4-mail-decomposition`
**선행:** Task 2 머지.

- [ ] 4-1 상수/설정 → `packages/business/src/mail/constants.ts` + `mail/policy-helpers.ts`
- [ ] 4-2 순수 규칙 분류 → `mail/classify-rules.ts`
- [ ] 4-3 AI 분류 → `mail/classify-ai.ts`
- [ ] 4-4 후보 생성 → `mail/candidates-generate.ts`
- [ ] 4-5 `mail-candidates.ts`는 re-export 전용 배럴로(잔여 로직은 `mail-candidates-impl.ts`), CCN 검증:
```bash
lizard packages/business/src/mail --CCN 15   # 위반 0
```
- [ ] Final PR: `refactor: Phase 4 — decompose mail-candidates god-file (P5)`

**Acceptance:** 각 신규 모듈 CCN<15, 외부 import 경로 무변화(배럴 유지), golden 무변화, 함수별 소속 모듈이 정본 문서의 표와 일치.

---

## Task 4: CRITICAL GATE — 지식 그래프 재학습

**배경:** Phase 5(business 재구조화, 06 문서)의 폴더 배치 의사결정이 understand-anything 지식 그래프에 의존한다. Phase 4로 파일 구조가 크게 바뀌므로 재학습 없이는 Phase 5 판단이 stale 그래프 기반이 된다.

- [ ] Phase 4 머지 후: `/understand --full --language ko -m deepseek/deepseek-v4-flash` 실행 (실행 정본 문서의 게이트 절 참조).
- [ ] 재학습 완료 확인 후 이 문서와 06 문서에 완료 표기.

---

## 1차 고도화 종료 게이트

- [ ] Task 0~4 전부 완료, PR 3건(Phase 2·3·4) 머지.
- [ ] 02 검증서 §4 릴리스 체크리스트 실행 (특히 golden 무변화 + 핵심 루프 라이브 재연 — 리팩토링이 메일→승인→전환 경로를 지나므로 시나리오 1 필수).
- [ ] `docs/DEV_REFERENCE.md` §6 소스 인벤토리 갱신 (mail/ 하위 구조 반영) + 변경 이력 1줄.
- [ ] 리스크 기록: 이 차수에서 발견한 행위 변경 유혹(버그처럼 보이는 기존 행위)은 고치지 말고 `docs/master-plan/backlog.md`에 적어 2차 이후로 이월.
