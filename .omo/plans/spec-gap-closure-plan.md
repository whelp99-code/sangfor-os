# Spec-Gap Closure Plan: Agentic Company OS (v3.2)

**목표:** MoSCoW Must Have 100%, Should Have 80% 달성  
**현재:** Must Have 67%, Should Have 50%, 전체 ~60%  
**목표 일정:** 4-6주 (개인 full-time 기준)

---

## Phase 0: 인프라 보강 (1주)

### 0.1 PostgreSQL RLS (M4) — 3-5일
**현재:** RLS 정책 없음. 모든 쿼리가 tenant 범위를 수동으로 검사하지만 DB 레벨 강제 없음.

**할 일:**
1. `prisma/migrations/`에 RLS migration 생성
   - `Tenant` 테이블: `tenant_id` 컬럼 추가 (기존 모델 대부분에 필요)
   - Supabase RLS 또는 PostgreSQL `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
   - 각 테이블별 POLICY 생성: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`

2. `packages/db/`에 RLS helper 함수 추가
   - `setTenantContext(tenantId: string)`: DB 세션에 tenant_id 설정
   - `getTenantContext()`: 현재 tenant_id 조회

3. API 미들웨어에 RLS context 적용
   - `apps/api/src/middleware/auth.ts`에서 인증 후 `setTenantContext()` 호출

4. 테스트: tenant 분리 테스트 (tenant A 데이터 조회 시 tenant B에 노출되지 않음)

**영향 파일:**
- `packages/db/prisma/schema.prisma` — tenant_id 필드 추가
- `packages/db/src/rls.ts` — 신규
- `apps/api/src/middleware/auth.ts` — RLS context 적용
- `prisma/migrations/` — RLS migration

---

### 0.2 Audit Log Hash Chain (M5 보강) — 2일
**현재:** AuditLog 모델은 있으나 hash chain 검증 없음.

**할 일:**
1. `packages/business/src/audit-chain.ts` 보강
   - SHA-256 해시 체인: `prev_hash = hash(prev_record.hash + current_record_data)`
   - 변조 탐지: 체인 무결성 검증 함수
2. Audit API Endpoint: `/api/audit/verify` — 체인 무결성 검증

**영향 파일:**
- `packages/business/src/audit-chain.ts` — hash chain 로직 추가
- `packages/business/src/audit-db.ts` — hash 계산 후 저장
- `apps/api/src/routers/` or routes — audit verify endpoint

---

## Phase 1: Business Logic 완성 (2주)

### 1.1 Deal Qualification (M10) — 3일
**현재:** Opportunity 모델만 있고 qualification 점수화 로직 없음.

**할 일:**
1. `packages/business/src/opportunity-stage.ts`에 Qualification Gate 추가
   - BANT 기준: Budget, Authority, Need, Timeline 각각 0-100점
   - 종합 점수: `weighted_score = budget*0.25 + authority*0.25 + need*0.3 + timeline*0.2`
   - 최소 통과 점수 60점
   - Qualification 결과를 `OpportunityStageEvent`에 기록
2. API: `POST /api/opportunities/:id/qualify` — 자격 검증 실행

**영향 파일:**
- `packages/business/src/opportunity-stage.ts` — qualification 로직
- `packages/business/src/opportunity-center.ts` — API 연동
- `apps/api/src/routers/business.router.ts` — 라우트 추가

---

### 1.2 Commercial Gate (M13) — 3일
**현재:** DiscountRequest 모델 있으나 Gate 자동화 미완.

**할 일:**
1. `packages/business/src/quote-engine.ts` 보강
   - 자동 Gate 규칙:
     - `margin < 15%` → CEO 승인 필요
     - `discount > 25%` → CEO 승인 필요
     - `payment_term > NET 60` → Finance 승인 필요
     - `total_amount > ₩500M` → Board 승인 필요
2. Gate 통과/실패 시 `ApprovalRequest` 자동 생성
3. Gate 결과를 `Quote` 상태에 반영: `DRAFT → GATE_REVIEW → APPROVED`

**영향 파일:**
- `packages/business/src/quote-engine.ts` — Commercial Gate 로직
- `packages/business/src/approval-gate.ts` — Gate 연동
- `packages/db/prisma/schema.prisma` — Quote 상태 enum에 GATE_REVIEW 추가

---

### 1.3 Delivery → Asset → Subscription 자동화 (M14, M15) — 5일
**현재:** CustomerAsset, Subscription 모델은 있으나 Delivery 완료 후 자동 생성 로직 없음.

**할 일:**
1. `packages/business/src/asset-renewal.ts` 구현
   - Delivery Project 완료(`status = DONE`) → 자동 `CustomerAsset` 생성
   - CustomerAsset → 자동 `License` 할당 → `Subscription` 생성
   - Subscription 만료 90/30/14일 전 → `NotificationEvent` 생성
   - 자동 Renewal Task 생성

2. API: 
   - `POST /api/delivery/:id/complete` → Asset 생성
   - `GET /api/renewals/upcoming` — 갱신 예정 목록
   - `GET /api/renewals/overdue` — 갱신 지연 목록

**영향 파일:**
- `packages/business/src/asset-renewal.ts` — 신규/보강
- `packages/db/prisma/schema.prisma` — 필요 시 필드 추가
- `apps/api/src/routers/business.router.ts` — 라우트 추가

---

### 1.4 Quote Builder 고도화 — 3일
**현재:** Quote, QuoteLineItem 있으나 제품 카탈로그 연동 부족.

**할 일:**
1. Quote 생성 시 ProductSku에서 자동 가격 조회
2. Multi-currency 지원 (KRW/USD)
3. Quote PDF 템플릿 작성
4. `Quote.status` 자동 전이: `DRAFT → REVIEW → APPROVED → SENT`

---

## Phase 2: UX 완성 (1.5주)

### 2.1 Role-based Dashboard (M17) — 5일
**현재:** 페이지는 있으나 UX 문서 대비 미달. "AI가 일하는 모습"이 안 보임.

**할 일:**
1. 각 역할 페이지에 AI Activity Feed 고도화 (이미 ai-workspace 컴포넌트 있음)
2. 대시보드에 AI 처리 현황 (오늘 처리 건수, 성공/실패) 추가
3. 빈 페이지에 Empty State 추가 ("아직 데이터가 없습니다. AI가 분석을 시작하면 여기에 표시됩니다.")
4. Approval Card 컴포넌트에 변경 Diff 표시 (S8 겸함)
5. Quote Builder UI 고도화: 제품 선택 → 수량 → 단가 → 견적서 흐름

**영향 파일:**
- `apps/web/src/app/(portal)/*/page.tsx` — 각 페이지 AI Activity 강화
- `apps/web/src/components/dashboard/` — 차트/KPI 추가
- `apps/web/src/components/approvals/` — Diff Viewer UI

---

### 2.2 Approval Diff Viewer (S8) — 2일
**현재:** 변경 전/후 비교 UI 없음.

**할 일:**
1. `components/approvals/diff-viewer.tsx` 신규
   - JSON Diff 시각화
   - 필드별 변경 전(red) → 변경 후(green) 표시
   - 접근성: 색상 + 아이콘 + 텍스트 병행
2. Approval 상세 페이지에 Diff Viewer 통합

---

### 2.3 UX Text Mapping 전면 적용 — 2일
**현재:** 일부 영어 상태명 잔존.

**할 일:**
1. 모든 페이지에서 `displayStatus()` 함수 사용 확인
2. `lib/ux-labels.ts` 상태 매핑 확장
3. Empty State 메시지 전면 한글화

---

## Phase 3: 고도화 (1.5주)

### 3.1 RCA Workflow (S5) — 3일
- Support Case 완료 시 RCA 작성 워크플로우
- 원인 분석 → 재발 방지 → 지식 저장 흐름

### 3.2 Retention/Legal Hold (S7) — 2일
- 프로젝트/문서 보존 정책 설정
- Legal Hold 플래그

### 3.3 Tenant Restore Drill (S9) — 2일
- Tenant 단위 백업/복원 스크립트
- DR(재해복구) 절차 문서화

### 3.4 ROI Dashboard (S10) — 3일
- AI 비용 대비 절감 시간 시각화
- 시간당 비용, 건당 비용, ROI %

---

## 최종 체크리스트

### Phase 0 (1주)
- [ ] PostgreSQL RLS 구현 (M4)
- [ ] Audit Hash Chain 보강 (M5)

### Phase 1 (2주)
- [ ] Deal Qualification (M10)
- [ ] Commercial Gate (M13)
- [ ] Delivery → Asset → Subscription (M14, M15)
- [ ] Quote Builder 고도화

### Phase 2 (1.5주)
- [ ] Role-based Dashboard UX 완성 (M17)
- [ ] Approval Diff Viewer (S8)
- [ ] UX Text Mapping 전면 적용

### Phase 3 (1.5주)
- [ ] RCA Workflow (S5)
- [ ] Retention/Legal Hold (S7)
- [ ] Tenant Restore Drill (S9)
- [ ] ROI Dashboard (S10)

---

## 추정 상세

| Phase | 항목 | 일수 | 비고 |
|-------|------|:---:|------|
| 0 | RLS | 4 | 설계 1일 + 구현 2일 + 테스트 1일 |
| 0 | Audit Hash Chain | 2 | |
| 1 | Deal Qualification | 3 | BANT 점수화 + API |
| 1 | Commercial Gate | 3 | 규칙 엔진 + Approval 연동 |
| 1 | Delivery→Asset→Subscription | 5 | 자동화 파이프라인 |
| 1 | Quote Builder | 3 | 카탈로그 연동 + PDF |
| 2 | Role-based Dashboard | 5 | AI Activity + Empty State |
| 2 | Diff Viewer | 2 | |
| 2 | UX Text Mapping | 2 | |
| 3 | RCA / Retention / Restore / ROI | 10 | 4개 병렬 가능 |
| | **합계** | **~39일** | **4-6주** |
