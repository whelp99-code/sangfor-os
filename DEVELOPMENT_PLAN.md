# Sangfor Agentic OS — 통합 개발 계획서

## 현재 상태 (Phase 0 완료)

| 항목 | 상태 |
|------|------|
| 7개 프로젝트 통합 | ✅ 960 files |
| 패키지명 @sangfor 통일 | ✅ 12 packages |
| Prisma Schema (87 Business + 16 New) | ✅ 103 models |
| pnpm install | ✅ 성공 |
| npm test | ⏳ 진행 예정 |

## Phase 1: API Layer 구축

### 1.1 Express API 앱 생성 (apps/api)
- AIOSv2_integration Express API 포팅
- tRPC 라우터 통합
- Health/Metrics/SSE endpoints
- JWT Auth middleware

### 1.2 Finance API 통합
- NestJS finance 패키지를 Express에 바인딩
- /api/finance/* routes
- Prisma → FinanceProject/Invoice/Expense/Cashflow 연동

## Phase 2: Build & Test Pipeline

### 2.1 각 패키지 빌드 확인
- packages/business (76 source files)
- packages/finance (46 source files)
- packages/auth/infra/security/cache/health/proxy-core

### 2.2 Test 실행
- packages/business: 30+ tests
- packages/finance: 0 tests (신규)
- packages/auth: 0 tests
- packages/db: seed tests
- E2E tests: Playwright + Cypress

## Phase 3: Business Layer 완성

### 3.1 Color Agent Organization
- color_agents.py 스켈레톤 → TypeScript로 구현
- ColorRoutingFunction: 입력 → 필요 Color 결정
- KanbanHandoffCard CRUD
- ColorReviewGate 체크 로직

### 3.2 Quote/Margin Engine
- QuoteServiceLineItem → 서버 마진 계산
- Commercial Gate: margin < 15% → CEO 승인 필요
- Discount Request 정책

### 3.3 Asset & Renewal Lifecycle
- CustomerAsset → License → Subscription → Renewal
- 자동 Renewal 알림 (30/14/7일 전)

## Phase 4: AI Quality Gate

### 4.1 Golden Answer Set
- AiGoldenAnswer: 7 categories, 155+ cases
- AiQualityResult: score, passed, details

### 4.2 Release Gate
- score >= 85
- prompt injection block >= 95%
- restricted leakage = 0

## Phase 5: 통합 검증

### 5.1 Prisma Migration
- pnpm db:push 실행
- DB 연결 확인

### 5.2 E2E 테스트
- Portal all pages functional
- CFO finance routes
- API health + metrics

### 5.3 최종 커밋
- 모든 변경사항 커밋
- 태그: v1.0.0
