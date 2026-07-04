# 2차 고도화 계획서 — 결정 스파인 완전 수렴 + AI 역할 재편 (04)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 착수 전 필독 3종: `00-INDEX.md` §3, `docs/convergence/PLAN.md`(FROZEN v5 — 불변식 정본), `docs/design/ai-roles.md`(v1 설계 정본). 이 문서는 Convergence §7 Follow-up register 전체와 ai-roles 코드 반영을 태스크화한 것이다.

**Goal:** ①모든 의사결정·학습 신호가 단일 스파인(`recordDecision()` → `domain_decision_logs`)으로 흐르고, ②recall(학습 회수)이 대칭·정확해지며, ③AI 역할 체계가 설계(ai-roles v1)와 코드에서 일치하는 상태.

**Architecture:** 스파인 불변식 유지 — ADDITIVE only, 기존 writer는 deprecate 후 위임(즉시 삭제 금지), `caseRef`는 `caseRefFor()`(`packages/business/src/case-ref.ts`) 경유.

**선행 조건:** 1차 고도화 완료 (Phase 4 분해 후의 `mail/` 구조를 전제로 함 — 파일 경로가 분해 전과 다르다. 아래 경로 중 `mail-candidates.ts:NNNN` 표기는 분해 후 해당 함수가 이주한 모듈에서 찾는다: `grep -rn "<함수명>" packages/business/src/mail`).

**전역 제약:** 00-INDEX §3 + 스키마 enum 변경은 additive만(값 추가 O, 의미 변경 X). 학습 데이터(DomainMemory)를 지우는 마이그레이션 금지.

---

## Part A: 결정 스파인 이월 작업 (Convergence §7)

**브랜치:** `feat/decision-spine-p2` (태스크별 커밋, 하나의 PR)

### Task A-1: 리치 메일 컨트랙트를 스파인 vocabulary로 연결
**Files:** Modify: `packages/business/src/mail/`(분해 후 classify 모듈), `packages/business/src/governance/ai-decision.ts`
- [ ] `MailClassificationDecision`/`computeMailUncertainty`/`projectMailCandidateType`의 산출을 `recordDecision()` 호출로 기록하도록 wire. decisionType은 기존 vocabulary에서 선택(신설 필요 시 ADR-001 부록에 추가 후).
- [ ] 테스트: 분류 1건 실행 시 `domain_decision_logs`에 정확히 1행, 필드(입력 요약·uncertainty·결정) 검증.
**Acceptance:** 메일 분류 경로에서 스파인 밖 기록 0 (`grep -rn "domainDecisionLog.create\|policyDecisionLog" packages/business/src/mail` → recordDecision 경유 외 0건).

### Task A-2: `recordDomainDecision` → `recordDecision` 위임
**Files:** Modify: `packages/business/src/domain-ai/domain-memory.ts` (구 :147 부근, `@deprecated` 마킹된 writer)
- [ ] 함수 시그니처는 유지(호출처 다수)하되 내부를 `recordDecision()` 호출로 교체. `colorGateJson` 등 확장 필드 전달이 누락되지 않는지 필드 대조표 작성 후 매핑.
- [ ] 기존 호출처의 통합 테스트(project-decision, domain-proposal)가 무변화 통과하는지 확인.
**Acceptance:** `domain_decision_logs` write 경로가 코드베이스에서 `recordDecision` 1곳뿐.

### Task A-3: recall 대칭 — same-case-key suppression
**Files:** Modify: `packages/business/src/domain-ai/domain-memory.ts`(`recallDomainMemories`), Test: Convergence Gate 9의 `test.todo`를 실테스트로 승격.
- [ ] 현재 결함: 지금 판단 중인 케이스 자신의 메모리가 recall되어 자기참조 오염. `recallDomainMemories(domain, tags, { excludeCaseRef })` 파라미터 추가, 호출처 전파.
- [ ] Gate 9 테스트(MUST FAIL 상태로 남아있던 것)를 활성화해 통과 확인.
**Acceptance:** Gate 9 green. 기존 recall 히트가 줄어드는 것은 정상(자기참조 제거) — 특성화 스냅샷 갱신은 별도 커밋 + 사유 명시.

### Task A-4: recall 태그 대칭 — `buildMemoryTags` 통일
**Files:** Modify: `packages/business/src/domain-ai/domain-proposal.ts`(:97 부근), `domain-agent-runtime.ts`(:142), `domain-embedding.ts`(:95)
- [ ] 세 곳의 수제 태그 생성을 `buildMemoryTags`(cherry-pick된 `bdcf333` 유틸)로 치환 — 쓰기 태그와 읽기 태그의 어휘가 같아야 recall이 명중한다.
- [ ] 테스트: 같은 입력으로 write→recall 왕복 시 태그 겹침이 0이 아님을 단언.
**Acceptance:** 태그 생성 로직 정의처 1곳.

### Task A-5: GtmDomain 실제 유도 (하드코딩 'sales' 제거)
**Files:** Modify: 구 `mail-candidates.ts:2094`의 함수가 이주한 모듈 (`grep -rn "'sales'" packages/business/src/mail`)
- [ ] 현재 결함: 메일 유래 결정 로그가 전부 `domain='sales'`. 후보 타입→도메인 매핑 함수 신설:
```ts
export function gtmDomainForCandidate(candidateType: string): GtmDomain;
// customer/opportunity류 → sales, poc/기술문의 → presales, 지원/자산 → engineer,
// 세금계산서/입금 → cfo, 캠페인/뉴스레터 → marketing. 매핑 불가 → sales(기본) + 근거 주석.
```
- [ ] 02 검증서 C-4 쿼리로 도메인 분포가 다양화됐는지 확인.
**Acceptance:** 신규 로그의 domain이 후보 유형을 반영. 기존 오염 행은 백필 스크립트(dry-run 기본)로 교정하거나, 교정 불가 사유를 기록.

### Task A-6: 소프트 삭제 + 삭제 캡처 (Convergence Step 7 전체)
**Files:** Migration: `archivedAt` additive 컬럼(대상: ax CRUD가 하드삭제하던 엔티티 — Convergence PLAN Step 7 목록), Modify: 각 삭제 라우트/함수 → archiver, `recordDecision(entity_archive)` 캡처.
- [ ] 마이그레이션(additive, G6 게이트) → archiver 함수(`archiveX`) → DELETE 라우트가 archiver 호출로 전환 → 목록 쿼리에 `archivedAt: null` 필터 추가(누락 시 유령 행 노출 — 전 목록 쿼리 grep 확인).
- [ ] 캡처: 보관 시 `recordDecision`에 `entity_archive` 기록(누가·무엇을·왜).
**Acceptance:** 하드 DELETE 경로 0 (`grep -rn "\.delete(" apps/web/src/app/api packages/business/src` 에서 archiver 미경유 실엔티티 삭제 0 — 테스트 정리용 deleteMany 제외).

### Task A-7: Step 6 잔여 — updateX 캡처 4건 + stage/field co-edit
- [ ] Convergence §7 Amendments의 미배선 `updateX` 4건에 `recordDecision(entity_edit)` wire (필드 diff 요약 포함).
- [ ] stage 변경과 필드 수정이 한 요청에 오는 co-edit도 단일 기록으로 캡처(이중 기록 금지).
**Acceptance:** CRUD 편집 전 경로가 스파인에 잡힘 — 편집 1회당 로그 정확히 1행.

### Task A-8: vocabulary 정합 + 메일 거절 대칭 학습
- [ ] spine vocabulary deviation 해소: `actor:"sales"`/`outcome:"corrected"`처럼 스키마 enum에 없는 값 사용처를 enum 정본에 맞춤(필요 시 enum에 `human`/`human_edit` **추가** — additive).
- [ ] 메일 거절 down-weighting: `maybeProposePolicyMemoryFromRejection`(구 mail-candidates.ts:1746-1793)이 승인만 학습하고 거절을 안 배우는 철학 갭 — 거절 시 해당 패턴의 negative weight 기록(구현은 DomainMemory outcome weight 체계 재사용).
**Acceptance:** enum 밖 값 기록 0 (C-4 쿼리 + enum 대조), 거절 학습 케이스 테스트 1건.

---

## Part B: AI 역할 재편 (ai-roles v1 코드 반영)

**브랜치:** `feat/ai-roles-v1`
**정본:** `docs/design/ai-roles.md` — 도메인 재정의: `marketing`(demand gen으로 재정의, 인입분류는 sales로), `sales` → `sales` + **`sales_support` 신설**, presales/engineer/cfo 유지.

### Task B-1: 도메인 상수 재편
**Files:** Modify: `packages/shared/src/modes.ts`(`GTM_PIPELINE`/`nextGtmDomain`/`isGtmDomain`, `ROLE_MODES`), `packages/business/src/domain-ai/domain-pipeline.ts`(도메인 정의·렌즈 라우팅·핸드오프)
- [ ] `sales_support`를 GTM 파이프라인에 삽입: `marketing → sales → sales_support → presales → engineer → cfo` (설계 문서의 위치 정의 재확인 — 영업지원은 sales와 presales 사이 사무 처리).
- [ ] 렌즈 기본값: ai-roles 역할 스펙 B(영업지원)에 맞춰 orange/gray 기본 배정(설계 문서 대조).
- [ ] `modes.test.ts`의 ROLE_MODES exact-equality 테스트 갱신(알려진 CI 함정 — DEV_REFERENCE §8).
- [ ] 소유 데이터 경계 정의: sales_support가 단독-writer인 모델 목록(Quote 사무처리, DealRegistration 등 — 설계 문서 기준)을 `domain-pipeline.ts` 주석과 표로 명시.

### Task B-2: 기존 데이터 호환
- [ ] `DomainMemory`/`DomainDecisionLog`의 기존 `domain` 값은 그대로 유효(문자열 컬럼, enum 아님 확인). `sales` 기존 행 중 영업지원 성격의 재배정은 **하지 않는다**(비파괴) — going-forward만 신도메인 사용.
- [ ] 대시보드/허브의 도메인 레인 렌더가 6도메인을 수용하는지(`buildLanes`, domain-pipeline 페이지) 확인·수정.

### Task B-3: 역할 AI 스펙 반영 (SLA·마진 룰)
- [ ] 엔지니어 SLA(응답 1일/해결 2일 — ai-roles 스펙 D)를 `SupportSlaPolicy` 시드로 등록, `/support` 화면 SLA 표시가 이 정책을 읽는지 확인.
- [ ] CFO 리뉴얼 마진 20% 룰(스펙 E)을 Orange 렌즈 결정형 게이트(`color-gate.ts`)의 fail 조건으로 반영 + 테스트 (리뉴얼 견적 마진<20% → orange fail).
**Acceptance:** 파이프라인 E2E(runDomainPipeline)가 6도메인으로 통과, SLA·마진 룰 테스트 green.

---

## 2차 고도화 종료 게이트

- [ ] Part A PR + Part B PR 머지, 게이트 4종 + `CI_INTEGRATION=1` green.
- [ ] 02 검증서 C-4 재실행: write 경로 단일화·도메인 분포 다양화 증거.
- [ ] 스파인 CI 게이트(Convergence §6의 12종 중 자동화된 것) 재실행.
- [ ] 라이브 재연: 메일 후보 승인 1건 + 프로젝트 허브 결정 1건 + CRUD 편집 1건 → `domain_decision_logs`에 3행, caseRef prefix(`mail_candidate:`/`eng:`/`opp:`) 정확.
- [ ] `docs/DEV_REFERENCE.md` 갱신 + `docs/convergence/PLAN.md` §7 항목에 완료 표기.
