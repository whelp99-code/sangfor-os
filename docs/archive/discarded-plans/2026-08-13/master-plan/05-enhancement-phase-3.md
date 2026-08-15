# 3차 고도화 계획서 — 자율운영: 자동승인·상시 파이프라인·와치독 (05)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans + superpowers:test-driven-development. 이 차수는 **행위가 새로 생기는** 작업(자동 결정)이므로 안전장치가 기능보다 먼저다 — 각 태스크의 "안전" 절을 스킵하면 그 태스크는 실패다. 착수 전 `00-INDEX.md` §3 필독.

**Goal:** 사람이 매번 누르던 것을 시스템이 스스로 돌리는 상태 — ①메일→분류→승인큐가 스케줄로 상시 가동, ②자율도가 높은 도메인×유형은 자동 승인(사후 보고), ③리뉴얼·SLA가 와치독으로 자동 감시, ④매일 아침 브리핑이 자동 생성 — 를 만든다. 제품 철학(human-in-the-loop → 학습 → 자율 대체)의 "자율" 단계 진입.

**Architecture:** 기존 스케줄 인프라(`/api/agent/schedules` + `schedules/tick`) 위에 파이프라인 잡을 등록한다. 자동승인은 새 실행 엔진이 아니라 **기존 `recordHumanDecision` 경로를 `actor=ai`로 재사용** — 스파인 감사가 그대로 적용된다.

**선행 조건:** 2차 고도화 완료 (스파인 단일화 + `computeAutonomy` 신뢰 가능). 01 문서 WP-C(파이프라인 1회 수동 가동 검증) 완료.

**전역 제약:** 00-INDEX §3 + 아래 자율운영 불변식:
- **돈이 걸린 결정은 자동화 금지(항상)**: 견적 발행, 할인 승인, 세금계산서 발행, 지출 승인은 이 차수에서 자동승인 대상 제외(화이트리스트 방식 — 명시된 유형만 자동화).
- **모든 자동 결정은 회수 가능**: 자동 승인된 항목은 24시간 내 사람이 뒤집을 수 있고, 뒤집힘은 negative 학습으로 기록된다.
- **kill-switch 필수**: env `AUTOPILOT_ENABLED=0` 또는 설정 화면 토글 한 번으로 모든 자동 결정이 즉시 멈춘다.

---

## Task 1: 자율운영 정책 모델 (AutonomyPolicy)

**Files:**
- Migration: `AutonomyPolicy` 모델 신설 (additive):
```prisma
model AutonomyPolicy {
  id            String   @id @default(cuid())
  domain        String            // GTM 도메인
  decisionType  String            // 예: mail_candidate_approve, ai_proposal_approve
  mode          String   @default("observe")  // observe | suggest | auto
  minAutonomy   Float    @default(0.9)        // computeAutonomy 임계값
  minSamples    Int      @default(10)         // 최소 사람-결정 표본
  requireColorGatePass Boolean @default(true)
  updatedBy     String?
  updatedAt     DateTime @updatedAt
  createdAt     DateTime @default(now())
  @@unique([domain, decisionType])
  @@map("autonomy_policies")
}
```
- Create: `packages/business/src/autonomy-policy.ts`, Test: `autonomy-policy.test.ts`

**Interfaces (Produces):**
```ts
export type AutonomyMode = "observe" | "suggest" | "auto";
export async function resolveAutonomyMode(input: {
  domain: string; decisionType: string;
  autonomy: { score: number; samples: number } | null;   // computeAutonomy 결과
  colorGatePass: boolean | null;
}): Promise<AutonomyMode>;
// 규칙: 정책 없음 → observe. kill-switch off → observe.
// auto 조건: policy.mode=auto AND autonomy.score>=minAutonomy AND samples>=minSamples
//            AND (requireColorGatePass ? colorGatePass===true : true). 하나라도 미달 → suggest로 강등.
```
- [ ] TDD: 강등 규칙 6케이스(정책없음/킬스위치/표본부족/점수미달/게이트fail/전부충족) 먼저 작성 → 구현 → 통과.
- [ ] 시드: 초기 정책은 전부 `observe`(자동화 0으로 시작). 커밋.

**Acceptance:** 전 케이스 green. 어떤 입력 조합에서도 정책·임계 미달 시 auto가 나오지 않음이 테스트로 보장.

## Task 2: 자동 승인 실행기 (메일 후보부터)

**Files:**
- Create: `packages/business/src/autopilot.ts`, Test: `autopilot.test.ts`
- Modify: 승인 실행은 기존 함수 재사용 — 메일 후보 승인 경로(`PATCH /api/mail-candidates/[id]`의 business 함수)와 `recordHumanDecision`(project-decision.ts)

**Interfaces:**
```ts
export async function runAutopilotPass(opts?: { dryRun?: boolean; limit?: number }): Promise<{
  scanned: number; autoApproved: number; suggested: number; skipped: number;
  results: Array<{ id: string; type: string; action: AutonomyMode; reason: string }>;
}>;
// pending 대상(1순위: mail_candidate 고신뢰 분류)을 스캔 → resolveAutonomyMode →
// auto면 승인 실행(actor='ai', 스파인 기록에 autopilot 표식 + policy id) / suggest면 큐 상단 플래그만.
```
- [ ] TDD: dryRun이 실쓰기 0인지, auto 실행이 스파인에 `actor='ai'`+정책 근거를 남기는지, 회수(사람이 반려로 뒤집기) 시 negative 학습이 기록되는지.
- [ ] **안전**: 실행 상한 `limit` 기본 20/패스, 연속 뒤집힘 3회 발생 시 해당 (domain,decisionType) 정책을 자동으로 `suggest`로 강등하고 알림 기록.
- [ ] API: `POST /api/autopilot/run` (수동 트리거, 관리자 전용) + 응답에 results 전체.

**Acceptance:** dryRun 리포트→실행→회수→강등의 전 사이클이 테스트로 재연. 화이트리스트 밖 유형(견적 등)은 스캔 자체에서 제외됨을 테스트로 보장.

## Task 3: 상시 파이프라인 스케줄 등록

**Files:** 기존 `/api/agent/schedules` 사용 (신규 인프라 금지). Create: `packages/business/scripts/register-pipeline-schedules.ts`
- [ ] 잡 4종 등록(스크립트는 멱등 — 이미 있으면 갱신):
  1. `mail-sync` 30분: `POST /api/mail-import` (위임형 OAuth 갱신 포함)
  2. `mail-classify` 1시간: 신규 후보 배치 분류(`/api/mail-candidates/batch`)
  3. `autopilot` 1시간: Task 2 실행기 (classify 후행)
  4. `daily-briefing` 평일 08:00 KST: Task 4 브리핑 생성
- [ ] tick 구동 확인: `schedules/tick`이 어떤 주체로 호출되는지 확인(`grep -rn "schedules/tick" scripts services .github`) — cron/호스트 타이머 미배선이면 로컬 launchd/cron 등록 스크립트 추가하고 문서화.
- [ ] 실패 내성: 각 잡은 실패 시 다음 주기 재시도(중복 방지 멱등 확인), 3연속 실패 시 unified-health에 degraded 노출.

**Acceptance:** 24시간 무인 방치 후 — 신규 메일이 후보로 적재·분류되고, 자동/제안 처리되고, 아침 브리핑이 생성되어 있음을 증거(스케줄 실행 로그 + C-2 쿼리 전후 비교)로 확인.

## Task 4: 일일 브리핑 실생성 (BriefBanner 데이터)

**Files:** Modify: `api/daily-report`의 business 함수 확장, my-work 코크핏 `BriefBanner`
- [ ] 브리핑 내용(전부 실쿼리): 어제 유입 메일/후보 수, 오늘 임박(리뉴얼 D-30/SLA 위반 임박/미결 승인), autopilot 활동 요약(자동 n건·제안 n건·뒤집힘 n건), 딜 스테이지 변화.
- [ ] LLM 요약은 선택 장식(9router로 3문장 요약) — LLM 다운 시 구조화 데이터만으로 렌더(폴백 필수).
**Acceptance:** 아침 코크핏 진입 시 어제와 다른 실데이터 브리핑. LLM 미기동 상태에서도 브리핑 렌더.

## Task 5: 리뉴얼·SLA 와치독

**Files:** Create: `packages/business/src/watchdog.ts`(+test), 스케줄 잡 `watchdog` 1일 1회 추가
- [ ] 리뉴얼: `RenewalOpportunity`/`MaintenanceContract`/`Subscription` 만료 D-90/60/30 → PortalTask 생성(중복 방지: 동일 대상+단계 unique) + 담당 도메인 큐 노출.
- [ ] SLA: `SupportCase` 중 응답 SLA(1일)/해결 SLA(2일 — 2차 고도화 Task B-3 정책) 임박·위반 → 태스크 + my-work 임박 섹션.
- [ ] CFO 마진: 리뉴얼 견적 마진<20%는 orange 게이트 fail이 이미 막는다(2차) — 와치독은 fail 상태로 7일 방치된 건을 에스컬레이션 목록화.
**Acceptance:** 만료 시나리오 시드로 D-30 태스크 자동 생성 + 중복 실행 시 1건 유지(멱등) 테스트.

## Task 6: 자율운영 관제 화면

**Files:** Modify: `(portal)/ai-team/page.tsx`(AI 팀 화면에 통합 — 신규 라우트 금지), 설정에 kill-switch 토글
- [ ] 표시(전부 실데이터): 도메인×유형별 정책 모드/임계, 자율도 현황(AutonomyDial — DESIGN.md 시그니처 컴포넌트), 최근 자동 결정 20건(뒤집기 버튼 포함), 뒤집힘율 추이.
- [ ] kill-switch: 설정 토글 → `AUTOPILOT_ENABLED` config(DB config_values) → 모든 auto 즉시 observe 강등. 토글 변경도 스파인에 기록.
**Acceptance:** 화면에서 정책 변경→다음 autopilot 패스에 반영, 토글 off→auto 0건 재연 스크린샷.

---

## 3차 고도화 종료 게이트 (KPI 포함)

- [ ] 전 태스크 PR 머지 + 02 검증서 게이트 전부 green.
- [ ] **KPI 기준선 채집** (이후 차수의 개선 측정 기준):
```sql
-- 자동화율: 최근 7일 결정 중 actor='ai' 비율
SELECT count(*) FILTER (WHERE actor='ai')::float / NULLIF(count(*),0) FROM domain_decision_logs WHERE "createdAt" > now()-interval '7 days';
-- 뒤집힘율: 자동 결정 중 사람이 반전한 비율 (목표 <5%, 초과 시 임계 상향)
-- 후보 처리 리드타임: 후보 생성→결정까지 중앙값
```
- [ ] 무인 24시간 운전 증거(Task 3) + 뒤집힘 자동 강등 1회 실연.
- [ ] `docs/DEV_REFERENCE.md` 갱신(스케줄 잡 4종+와치독, kill-switch 위치) + memlog 기록.
