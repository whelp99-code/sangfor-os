# Phase 5 Implementation Plan — business 패키지 재편: 도메인별 폴더 구조

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** packages/business/src의 평면 구조 (188개 .ts 파일)를 9개 도메인 폴더로 정리하여 cohesion 향상 및 유지보수성 개선.

**Architecture:** 
1. 현재: packages/business/src/*.ts (평면, 일부 폴더 포함: llm/, mail/, outlook/, phase14/, skills/)
2. 목표: 도메인별 폴더 생성 → 파일 이동 → re-export 정리 → 의존성 검증

각 도메인은 독립적인 index.ts re-export를 가지며, packages/business/src/index.ts에서 일괄 re-export되어 외부 API 호환성 유지.

**Tech Stack:** TypeScript, Prisma, vitest, packages/business package.json exports map

## Global Constraints

- **Phase 0 golden snapshot**: mail-candidates 관련 test 무변화 필수
- **Re-export 전략**: 모든 public API는 packages/business/src/index.ts에서 re-export (호환성)
- **Circular imports**: 없어야 함 (import 순서: util → domain → orchestration → public API)
- **각 커밋**: `refactor:` prefix (행위 무변화)
- **typecheck & test**: 각 task 후 `pnpm typecheck`, `pnpm test --filter @sangfor/business`
- **phase14/ 제거**: 기존 네이밍 폐기

---

## 폴더 구조 (목표)

```
packages/business/src/
├── mail/                    (Phase 4 산출 + 추가 통합)
│   ├── constants.ts
│   ├── classify-rules.ts
│   ├── classify-ai.ts
│   ├── candidates-*.ts
│   ├── policy-decision-log.ts
│   ├── outlook-graph.ts
│   ├── outlook-sync.ts
│   └── index.ts (re-export)
├── domain-ai/              (domain-*.ts 19개)
│   ├── index.ts
│   └── [각 도메인별 module]
├── crm/                    (customer, opportunity, deal, quote, proposal)
│   ├── customer-partner.ts
│   ├── opportunity-*.ts
│   ├── deal-*.ts
│   ├── quote-*.ts
│   ├── proposal-*.ts
│   └── index.ts
├── finance/                (revenue, executive, expense)
│   ├── executive-dashboard.ts
│   ├── revenue-*.ts
│   ├── expense-*.ts
│   └── index.ts
├── governance/             (approval, audit, validation, ai-decision)
│   ├── approval-*.ts
│   ├── audit-*.ts
│   ├── validation-*.ts
│   ├── ai-decision-*.ts
│   └── index.ts
├── orchestration/          (automation, workflow, task)
│   ├── automation-*.ts
│   ├── workflow-*.ts
│   ├── task-*.ts
│   └── index.ts
├── platform/               (llm, observability, notifications)
│   ├── llm/
│   ├── observability/
│   ├── notifications/
│   └── index.ts
├── support/                (support-case, ticket)
│   ├── support-case-*.ts
│   └── index.ts
├── infrastructure/         (services, integrations)
│   ├── services/
│   ├── integrations/
│   └── index.ts
├── llm/                    (기존 유지, platform으로 이동 예정)
├── outlook/                (기존 유지, mail로 통합 예정)
├── skills/                 (기존 유지)
├── __snapshots__/          (기존 유지)
├── __tests__/              (기존 유지)
├── index.ts                (모든 public API re-export)
└── [현재 root level의 util/helper files 정리]
```

---

## Task 분할 (병렬 가능)

```
Batch 1 (독립적, 작은 도메인): 
  - Task 5-1: domain-ai/ 폴더 생성 및 19개 domain-*.ts 이동
  - Task 5-2: crm/ 폴더 생성 및 파일 이동

Batch 2 (중간):
  - Task 5-3: finance/, governance/ 폴더 생성 및 파일 이동
  
Batch 3 (복잡, 의존성 많음):
  - Task 5-4: orchestration/, support/, infrastructure/ 폴더 생성

Batch 4 (마무리):
  - Task 5-5: platform/ 폴더 재편 (llm 통합)
  - Task 5-6: mail/ 폴더 최종 정리 (outlook 통합)
  - Task 5-7: phase14/ 제거 및 기존 phase11-14 네이밍 전폐
  - Task 5-8: packages/business/src/index.ts 재정리 (모든 re-export 정의)
  - Task 5-9: package.json exports map 갱신

총 9개 task, 병렬 가능 (Batch별 4-5개 파일 이동)
```

---

## Task 5-1: domain-ai/ 폴더 생성 및 domain-*.ts 이동

**파일:**
- Create: `packages/business/src/domain-ai/index.ts`
- Move: `domain-*.ts` (19개) → `packages/business/src/domain-ai/`
- Modify: `packages/business/src/index.ts` (import 경로 수정)

**현재 domain-*.ts 목록 (ls -1 packages/business/src/domain-*.ts):**
```
domain-ai-agent.ts
domain-ai-strategy.ts
domain-proposal.ts
domain-pipeline.ts
domain-routing.ts
domain-stage.ts
domain-validation.ts
domain-dashboard.ts
[... 12개 더]
```

**Steps:**

- [ ] **Step 1: domain-ai/ 디렉토리 생성**

```bash
mkdir -p packages/business/src/domain-ai
```

- [ ] **Step 2: 모든 domain-*.ts 파일을 domain-ai/로 이동**

```bash
mv packages/business/src/domain-*.ts packages/business/src/domain-ai/
mv packages/business/src/domain-*.test.ts packages/business/src/domain-ai/ 2>/dev/null || true
```

- [ ] **Step 3: packages/business/src/domain-ai/index.ts 생성**

```typescript
// packages/business/src/domain-ai/index.ts
// Re-export all domain-ai modules

export * from './domain-ai-agent.js';
export * from './domain-ai-strategy.js';
export * from './domain-proposal.js';
export * from './domain-pipeline.js';
export * from './domain-routing.js';
export * from './domain-stage.js';
export * from './domain-validation.js';
export * from './domain-dashboard.js';
// ... 모든 domain-*.ts 파일들
```

- [ ] **Step 4: packages/business/src/index.ts에서 domain 관련 import 수정**

기존:
```typescript
export * from "./domain-ai-agent";
export * from "./domain-proposal";
```

변경:
```typescript
export * from "./domain-ai/index.js";
```

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck --filter @sangfor/business
```

Expected: 0 errors

- [ ] **Step 6: test**

```bash
pnpm test --filter @sangfor/business -- --run
```

Expected: 모든 test pass (domain 관련 test 포함)

- [ ] **Step 7: Commit**

```bash
git add packages/business/src/domain-ai/ packages/business/src/index.ts && \
git commit -m "refactor: move domain-ai modules to domain-ai/ folder (P15)"
```

---

## Task 5-2: crm/ 폴더 생성 및 CRM 관련 파일 이동

**파일:**
- Create: `packages/business/src/crm/index.ts`
- Move: customer-partner.ts, opportunity-*.ts, deal-*.ts, quote-*.ts, proposal-*.ts → crm/

**현재 파일 목록:**
```
customer-partner.ts
opportunity-center.ts
opportunity-stage.ts
opportunity-status-update.ts
deal-registration.ts
quote-*.ts (2개)
proposal-generator.ts
```

**Steps:**

- [ ] **Step 1: crm/ 디렉토리 생성**

```bash
mkdir -p packages/business/src/crm
```

- [ ] **Step 2: CRM 관련 파일 이동**

```bash
mv packages/business/src/customer-partner.ts packages/business/src/crm/
mv packages/business/src/opportunity-*.ts packages/business/src/crm/
mv packages/business/src/deal-*.ts packages/business/src/crm/
mv packages/business/src/quote-*.ts packages/business/src/crm/
mv packages/business/src/proposal-*.ts packages/business/src/crm/
# test 파일도 함께
mv packages/business/src/customer-partner.test.ts packages/business/src/crm/ 2>/dev/null || true
# ... 모든 .test.ts 파일
```

- [ ] **Step 3: packages/business/src/crm/index.ts 생성**

```typescript
// packages/business/src/crm/index.ts
export * from './customer-partner.js';
export * from './opportunity-center.js';
export * from './opportunity-stage.js';
export * from './opportunity-status-update.js';
export * from './deal-registration.js';
export * from './quote-*.js';
export * from './proposal-generator.js';
```

- [ ] **Step 4: packages/business/src/index.ts 수정**

```typescript
export * from "./crm/index.js";
```

- [ ] **Step 5: typecheck & test**

```bash
pnpm typecheck --filter @sangfor/business && \
pnpm test --filter @sangfor/business -- --run
```

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/crm/ packages/business/src/index.ts && \
git commit -m "refactor: move CRM modules to crm/ folder (P15)"
```

---

## Task 5-3, 5-4, ... (패턴 동일)

각 도메인별로 동일한 패턴:
1. 폴더 생성
2. 관련 파일 이동
3. index.ts 생성 (re-export)
4. packages/business/src/index.ts 수정
5. typecheck & test
6. commit

**Task 5-3**: finance/ (revenue-*.ts, executive-*.ts, expense-*.ts)
**Task 5-4**: governance/ (approval-*.ts, audit-*.ts, validation-*.ts, ai-decision-*.ts)
**Task 5-5**: orchestration/ (automation-*.ts, workflow-*.ts, task-*.ts)
**Task 5-6**: support/ (support-case-*.ts)
**Task 5-7**: infrastructure/ (services, integrations)

---

## Task 5-8: platform/ 폴더 재편 (llm 통합)

**파일:**
- Modify: packages/business/src/llm/ → packages/business/src/platform/llm/
- Create: packages/business/src/platform/observability/ (notification-*.ts 이동)
- Create: packages/business/src/platform/index.ts

**Steps:**

```bash
mkdir -p packages/business/src/platform
mv packages/business/src/llm packages/business/src/platform/
mkdir -p packages/business/src/platform/observability
mv packages/business/src/notification-*.ts packages/business/src/platform/observability/ 2>/dev/null || true
```

생성: `packages/business/src/platform/index.ts`
```typescript
export * from './llm/index.js';
export * from './observability/index.js';
```

수정: `packages/business/src/index.ts`
```typescript
export * from "./platform/index.js";
```

---

## Task 5-9: phase14/ 제거 및 index.ts 최종 정리

- [ ] **Step 1: phase14/ 폴더 제거**

```bash
rm -rf packages/business/src/phase14/
```

- [ ] **Step 2: packages/business/src/index.ts 전체 재구성**

최종 형태:
```typescript
// packages/business/src/index.ts
// Public API barrel export

// Domain AI
export * from "./domain-ai/index.js";

// CRM
export * from "./crm/index.js";

// Finance
export * from "./finance/index.js";

// Governance
export * from "./governance/index.js";

// Orchestration
export * from "./orchestration/index.js";

// Platform
export * from "./platform/index.js";

// Mail
export * from "./mail/index.js";

// Support
export * from "./support/index.js";

// Infrastructure
export * from "./infrastructure/index.js";

// Skills (유지)
export * from "./skills/index.js";

// Utilities & Helpers (root level 유지되는 것들)
export * from "./llm-settings.js";
export * from "./openai-config.js";
// ... 기타 utility functions
```

- [ ] **Step 3: package.json exports map 갱신**

현재:
```json
"exports": {
  "./opportunity-stage": "./src/opportunity-stage.ts",
  "./llm/config": "./src/llm/config.ts",
  ...
}
```

변경:
```json
"exports": {
  "./domain-ai": "./src/domain-ai/index.ts",
  "./crm": "./src/crm/index.ts",
  "./finance": "./src/finance/index.ts",
  "./governance": "./src/governance/index.ts",
  "./orchestration": "./src/orchestration/index.ts",
  "./platform": "./src/platform/index.ts",
  "./platform/llm": "./src/platform/llm/index.ts",
  "./mail": "./src/mail/index.ts",
  "./support": "./src/support/index.ts",
  "./infrastructure": "./src/infrastructure/index.ts",
  // 기존 public API 호환성 유지
  "./opportunity-stage": "./src/crm/opportunity-stage.ts",
  "./customer-partner": "./src/crm/customer-partner.ts",
  ...
}
```

- [ ] **Step 4: 전역 typecheck & test**

```bash
pnpm typecheck && \
pnpm test --filter @sangfor/business -- --run
```

Expected: 모든 test pass, Phase 0 golden snapshot 무변화

- [ ] **Step 5: Commit**

```bash
git add packages/business/src/index.ts packages/business/package.json && \
git commit -m "refactor: remove phase14 folder and finalize business package structure (P15)"
```

---

## Phase 5 최종 게이트

- [ ] **모든 9개 task 완료 확인**

```bash
git log --oneline | grep "refactor: " | head -10
```

Expected: 9개 refactor commits (P15)

- [ ] **전역 타입 검사**

```bash
pnpm typecheck
```

Expected: 0 errors

- [ ] **Mail 분류 스냅샷 무변화** (Phase 0 보호)

```bash
pnpm test --filter @sangfor/business -- mail-candidates.golden.test.ts
```

Expected: all snapshots match

- [ ] **Package 구조 검증**

```bash
ls -1d packages/business/src/*/
```

Expected: 9개 폴더 (crm, domain-ai, finance, governance, infrastructure, mail, orchestration, platform, support)

---

## 예상 작업량

- 약 50-100개 파일 이동
- 9개 새로운 index.ts 생성
- package.json exports map 대량 수정
- 9-12개 commits
- 소요 시간: 2-3시간 (병렬 처리 시)

---

## 참고

- **호환성**: packages/business 외부의 import (apps/web, apps/api 등)은 index.ts re-export를 통해 유지됨
- **circular import**: 도메인 간 의존성이 있을 경우 (예: crm→governance approval), util 계층을 통해 처리
- **phase14 폐기**: 더 이상 phase11-14 naming convention 사용 안 함 (P15+부터 phase5+)
