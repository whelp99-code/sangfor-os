# Phase 2 완료 및 Phase 3 준비 계획

> **작성**: 2026-07-03 · **상태**: Task 1-6 진행 중 (1, 5, 6 완료 / 2, 3, 4 진행 중)

---

## Part A: Phase 2 마무리 (즉시 실행)

### A1. Task 2, 3, 4 완료 대기 (예상 5-10분)

| Task | Description | Status |
|---|---|---|
| 2 | 메일 도메인 레지스트리 | 🔄 Running |
| 3 | sanitizeJsonStrings 추출 | 🔄 Running |
| 4 | Outlook 동기화 통합 | 🔄 Running |

각 task 완료 시 opencode가 자동 commit 생성.

### A2. Task Reviewer 단계 (병렬 실행)

**2-3개 task reviewer 에이전트** dispatch:
- 각 task의 diff 파일 생성 (`scripts/review-package BASE HEAD`)
- Task spec compliance 검증 (요구사항 충족?)
- Code quality 검증 (테스트, 타입, 중복 제거 확인?)

**Reviewer 체크리스트 (각 task):**
- ✅ Spec 목표 달성 여부 (파일 생성/삭제/import 정리)
- ✅ Phase 0 스냅샷 무변화 (2-2, 2-4 는 critical)
- ✅ 타입 에러 없음
- ✅ Import path 정합성
- ✅ Test 전부 PASS

### A3. 이슈 해소 (발견 시)

**Critical/Important 찾아지면** → fix subagent dispatch:
- 발견 내용 명시
- 수정 후 reviewer 다시 실행
- PASS 될 때까지 반복

**Minor 이슈** (e.g., 공유 워킹트리 package.json 혼합):
- 기록만 해두고 최종 PR 시 수정
- 또는 별도 cleanup commit으로 처리

### A4. Final PR 생성

**조건:**
- ✅ Task 2-6 reviewer 모두 PASS
- ✅ 모든 commit이 main 대비 valid
- ✅ pnpm typecheck/test 전역 상태 확인

**PR 내용:**
```
Title: refactor: Phase 2 — deduplication (P8, P10, P12)

Body:
## Summary
Remove 7 duplicate implementations across KRW formatters, mail domains, 
LLM settings, Outlook sync, dashboard logic.

## Commits
- Task 1: refactor: unify KRW formatters (42a283c)
- Task 2: consolidate mail domain constants (TBD)
- Task 3: extract sanitizeJsonStrings (TBD)
- Task 4: consolidate Outlook sync (TBD)
- Task 5: unify LLM config (24ac77e)
- Task 6: extract dashboard logic (0ff7481)

## Test Results
- All golden snapshots: PASS (Phase 0 無変化)
- Unit tests: PASS
- Typecheck: PASS
- [Known: package.json cleanup needed (side effect of parallel tasks)]

Closes: [related refactoring #]
```

**Timeline:** 30분 이내 완료 예상

---

## Part B: Phase 3 착수 계획 (Phase 2 PR merge 후)

### B1. Phase 3 목표 및 범위

**Phase 3: 레이어 정리 — web route → business**

계획서: docs/plans/2026-07-02-problem-based-refactoring-plan.md §Phase 3

**목표:** web API route에 내장된 비즈니스 로직 → business 모듈로 추출.
- 11개 route에서 prisma 직접 사용 제거
- 각 route는 "인증 + 파싱 + business 호출 + 직렬화"만 담당
- Nexias 하드코딩 특례(cleanup) 처리

**Critical dependency:**
- Phase 2 MERGE 필수 (mail-domain-registry 등이 Phase 3에서 참조될 수 있음)
- Phase 0 golden snapshot green 상태 유지

### B2. Phase 3 작업 분해

```
Phase 3-1: prisma 직접 사용 11개 route 이관
  - actions/[actionKey]/validate
  - daily-report
  - dashboard/[role]  (← 2-6 산출물과 상호작용)
  - domain-pipeline
  - mail-candidates/batch, cleanup, convert
  - mail-insight-threads/generate
  - modules/[moduleKey]/validate
  - policy-memories/[id]
  
Phase 3-2: "demo-project" 하드코딩 18곳 → scope.ts 단일화

Phase 3-3: apps/api REST CFO 정리 (타입화, zod, error handling)
```

**각 task = 원자 커밋** (가장 작은 단위로 분해)

### B3. 예상 규모 및 난이도

| Task | 파일 | LOC | Complexity | Est. Time |
|---|---|---|---|---|
| 3-1 | ~11 routes | 50-200/route | Medium | 45min × 11 = 8-10h |
| 3-2 | scope.ts, 18처 | ~100 | Low | 30min |
| 3-3 | 5 services | ~500 | Medium-High | 2-3h |

**Total:** 10-13시간 (병렬 처리로 3-4시간)

### B4. Phase 3 실행 전 사전 준비

**1. 각 route의 현재 로직 감사 (30분)**
```bash
# 각 route마다 business 함수 유사성 확인
grep -n "prisma\|db\." apps/web/src/app/api/{actions,daily-report,...}/route.ts

# 기존 business 함수와 중복 여부 확인
# 예: mail-candidates/cleanup의 nexias 하드코딩과 business 의 기존 로직 대비
```

**2. Nexias 특례 처리 방침 결정 (사용자 선택)**
- Option A: mail-domain-registry (Task 2)에 NEXIAS_SPECIAL_CASE 상수 추가
- Option B: scope.ts (3-2)에서 함께 처리
- Option C: cleanup route에만 조건부 유지

→ **사용자 결정 필요**

**3. dashboard/[role] 통합 계획**
- Phase 2 Task 6 (role-dashboard.ts) 산출물 활용
- web route가 이미 추출된 함수를 호출하는지 재확인
- tRPC dashboard.router와의 이중화 해소 (Phase 6에 미루되, 주의)

### B5. Phase 3 진행 방식

**subagent-driven-development + opencode-coder 병렬:**

```
Task 3-1: 11개 route × 1 commit = 11개 opencode 에이전트 동시 dispatch
  ├─ actions/validate
  ├─ daily-report
  ├─ dashboard/[role]
  ├─ domain-pipeline
  ├─ mail-candidates/{batch, cleanup, convert}
  ├─ mail-insight-threads/generate
  ├─ modules/validate
  └─ policy-memories/[id]

Task 3-2: scope.ts 단일화 (1 agent)

Task 3-3: api/routes/cfo.ts 정리 (1 agent, 가장 복잡)
```

**Wall-clock: ~3-4시간 (11개 병렬 + 마무리)**

### B6. Phase 3 Blocker 및 위험요소

**높음:**
1. mail-candidates/cleanup의 nexias 하드코딩 제거 시 실제 mail 분류 동작 변경 가능 → Phase 0 snapshot 검증 필수
2. dashboard/[role] 통합 시 role-dashboard.ts 산출물과 정합성 → 중복 제거 확인

**중간:**
1. 11개 route 동시 refactoring이므로 git conflict 가능성 → worktree 분산 고려
2. apps/api CFO 정리는 finance 서브시스템에 영향 → 세밀한 테스트 필요

**낮음:**
1. scope.ts 하드코딩 제거는 단순 치환

### B7. Phase 3 완료 기준

**DoD (Definition of Done):**
- ✅ 11개 route 모두 business 호출로 전환
- ✅ route.ts는 "auth + parse + business + serialize" 4줄만
- ✅ Phase 0 golden snapshot 무변화
- ✅ pnpm typecheck/test 전부 green
- ✅ route별 integration test (request/response 동등성)
- ✅ PR #N (Phase 3) merge

---

## Part C: Phase 4-5 미리보기

### C1. Phase 4 — God-file 분해 (2-3주)

**대상:** mail-candidates.ts (2,260줄, 최우선)
- 상수 → 도메인 레지스트리 (Phase 2 기반)
- 순수 함수 → mail/classify-rules.ts
- AI 분류 → mail/classify-ai.ts
- DB 부수효과 → mail/candidates-{generate,approve}.ts
- 복잡도 함수 정리 (CCN 39 → <15)

### C2. Phase 5 — business 패키지 재편 (1-2주)

**구조 전환:**
```
packages/business/src/
  mail/          ← Phase 4 산출
  domain-ai/     ← domain-* 19개
  crm/           ← opportunity/deal/quote/proposal
  finance/       ← executive dashboard, revenue
  governance/    ← approval, audit, validation
  orchestration/ ← automation, workflows
  platform/      ← llm/, observability, notifications
```

**phase11-14 네이밍 전폐**

### C3. 이후 Phase

- **Phase 6:** API 표면 단일화 (web BFF, tRPC 정리) — ADR 필요
- **Phase 7:** DB 스키마 정리 (expand-contract, 인덱스 추가)

---

## 타이밍 및 리소스

### 예상 일정

| Phase | Duration | Worker | Status |
|---|---|---|---|
| Phase 0 | Complete | (merged) | ✅ 완료 |
| Phase 1 | 2시간 | opencode×3 | ✅ 완료 (PR #84) |
| **Phase 2** | **2-3시간** | **opencode×6** | **🔄 진행 중** |
| Phase 3 | 3-4시간 | opencode×11 | ⏳ 다음 (depends Phase 2) |
| Phase 4 | 6-8시간 | opencode×5 + review | 📅 주차 2 예상 |
| Phase 5 | 4-6시간 | opencode×1 + review | 📅 주차 2-3 |
| Phase 6 | TBD | — | 📅 ADR 후 결정 |
| Phase 7 | TBD | — | 📅 ADR 후 결정 |

**총 refactoring: 2-3주** (병렬 처리 가정)

### 리소스

- **opencode:** deepseek v4pro (quota 제약 없음, session당 ~30분)
- **Reviewer:** task-reviewer agent (검증)
- **Monitoring:** 사용자 (의사결정, 이슈 처리)

### 의사결정 포인트

| ID | 질문 | Deadline |
|---|---|---|
| D | .superpowers, memory/agent-handoffs 처리 | Phase 1 ✅ |
| E | 메일 도메인 3벌 병합 기준 | Phase 2 (사용자 결정 완료) ✅ |
| **D2** | **Nexias 특례 처리 방침** | **Phase 3 시작 전** |
| **G** | **persona/mail-intelligence 흡수 여부** | **Phase 5 시작 전** |

---

## 다음 즉시 액션

1. **5-10분:** Task 2, 3, 4 완료 대기
2. **30분:** Task reviewer 병렬 실행
3. **1시간:** Issue 수정 (있으면)
4. **2시간:** Phase 2 PR merge
5. **사용자 선택 (D2):** Nexias 특례 처리 방침
6. **Phase 3 시작:** scope.ts 계획, 11개 route 감사 후 opencode 병렬 dispatch

---

## 참고

- **메모리:** ~/me-wiki/INDEX.md, ~/unified-db/bin/memlog recall
- **이전 phase:**
  - Phase 0 결과: e2e 100개 spec, 특성화 테스트 47개, 커버리지 기준선
  - Phase 1 결과: 6,881줄 삭제, 5개 죽은 패키지 제거
  - Phase 2 결과: (진행 중) 6개 중복 통합 예정
- **CI/CD:** Phase 8 (이미 완료) — TS 5.9.3, vitest 3.2.4, CI 2배 속도
