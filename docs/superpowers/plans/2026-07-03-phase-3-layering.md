# Phase 3 Implementation Plan — 레이어 정리: web route → business

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web API route의 비즈니스 로직을 packages/business로 추출하여 route는 "auth + parse + business call + serialize"만 담당하도록 정리.

**Architecture:** 11개 web route를 개별 task로 분해. 각 route마다: ① 기존 prisma 직접 사용 로직을 business 함수로 추출 ② route에서 business 호출로 전환 ③ Phase 0 golden snapshot 무변화 검증. route별 업무량이 다르므로 병렬 처리 권장 (작은 route 3개 세션 + 중간 route 3개 세션 + 대형 route 2개 세션 + 특수 route 3개 세션).

**Tech Stack:** TypeScript, Prisma, vitest (golden snapshot), packages/business, packages/shared.

## Global Constraints

- **각 커밋 유형**: `refactor:` (구조 변경, 행위 무변화)
- **검증 게이트**: 각 task 후 `pnpm typecheck` (로컬 충분, Phase 종료 후 전역 gate)
- **스냅샷 보호**: mail-candidates 관련 route (batch/cleanup/convert, mail-insight-threads/generate)는 Phase 0 golden snapshot 무변화 필수 확인
- **Phase 의존성**: Phase 2 merge 완료 필수 (mail-domain-registry 등 참조)
- **worktree 위험**: 동시 다중 agent 실행 시 git conflict 가능 → branch 분산 또는 순차 실행 권장

---

## Route 분석 현황 (파일 크기 + Prisma 사용도)

| Route | 파일 크기 | Prisma 사용 | 복잡도 | Task ID |
|---|---|---|---|---|
| `actions/[actionKey]/validate` | 36줄 | 2회 | 🟢 낮음 | 3-A |
| `settings/llm` | 29줄 | 0회 | 🟢 낮음 | 3-B |
| `policy-memories/[id]` | 22줄 | 2회 | 🟢 낮음 | 3-C |
| `domain-pipeline` | 19줄 | 2회 | 🟢 낮음 | 3-D |
| `mail-candidates/batch` | 58줄 | 3회 | 🟡 중간 | 3-E |
| `mail-candidates/cleanup` | 62줄 | 5회 | 🟡 중간 | 3-F |
| `modules/[moduleKey]/validate` | 117줄 | 3회 | 🟡 중간 | 3-G |
| `mail-insight-threads/generate` | 119줄 | 6회 | 🟡 중간 | 3-H |
| `dashboard/[role]` | 117줄 | 13회 | 🟠 높음 | 3-I |
| `daily-report` | 61줄 | 10회 | 🟠 높음 | 3-J |
| `mail-candidates/convert` | **196줄** | **25회** | 🔴 매우 높음 | 3-K |

**소계**: 11개 route, 총 838줄, prisma 총 91회 직접 사용.

---

## Task 분할 전략 (병렬 세션)

```
Batch 1 (작은 task 3개, 독립적): 3-A, 3-B, 3-C
Batch 2 (중간 task 3개): 3-D, 3-E, 3-F
Batch 3 (중간-큰 task 2개, 특수): 3-G, 3-H
Batch 4 (가장 큼 2개, 스냅샷 critical): 3-I, 3-J
Batch 5 (최대 규모 1개, 별도): 3-K

총 5개 opencode-coder 세션 (병렬 시: 각 batch = 1 세션)
또는 3 개 세션 (1-3줄 merge, 4-5는 순차)
```

---

## Task 3-A: actions/[actionKey]/validate 레이어링

**파일:**
- Modify: `apps/web/src/app/api/actions/[actionKey]/validate/route.ts` (36줄)
- Create: `packages/business/src/action-validation.ts` (신규)
- Modify: `packages/business/src/index.ts` (export 추가)

**Interfaces:**
- Consumes: 
  - `validateAction(actionKey: string): Promise<ValidationResult>` (기존, @sangfor/business/action-connector-runtime)
  - `prisma` (direct DB access)
- Produces: 
  - `export async function validateActionWithDb(actionKey: string): Promise<ValidationResult>` (신규)
  - interface `ValidationResult { isValid: boolean; errors?: string[] }`

**Steps:**

- [ ] **Step 1: 현재 route의 로직 파악**

```bash
grep -A 30 "export async function POST" apps/web/src/app/api/actions/[actionKey]/validate/route.ts
```

Expected: validateAction() 호출 + prisma query 2회 (action 기존 여부 확인, 결과 저장)

- [ ] **Step 2: packages/business/src/action-validation.ts 신설**

```typescript
// packages/business/src/action-validation.ts
import { prisma } from "@sangfor/db";

export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
  action?: any;
}

/**
 * Validate an action and persist result to DB.
 * Extracted from apps/web route to decouple presentation from persistence.
 */
export async function validateActionWithDb(actionKey: string): Promise<ValidationResult> {
  // 1. Fetch existing action from DB
  const existing = await prisma.action.findUnique({
    where: { key: actionKey }
  });
  
  if (!existing) {
    return { isValid: false, errors: ["Action not found"] };
  }
  
  // 2. Validate (business logic)
  const isValid = existing.status !== 'DISABLED';
  
  // 3. Persist validation result
  await prisma.actionValidationLog.create({
    data: { actionKey, isValid, timestamp: new Date() }
  });
  
  return { isValid, action: existing };
}
```

- [ ] **Step 3: packages/business/src/index.ts에 export 추가**

```typescript
export * from './action-validation'
```

- [ ] **Step 4: route를 얇은 어댑터로 전환**

```typescript
// apps/web/src/app/api/actions/[actionKey]/validate/route.ts
import { validateActionWithDb } from '@sangfor/business';
import { NextResponse } from 'next/server';
import { apiError, assertApiAccess } from '@/lib/api-auth';

export async function POST(req: NextRequest, { params }: { params: { actionKey: string } }) {
  assertApiAccess(req);
  
  try {
    const result = await validateActionWithDb(params.actionKey);
    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}
```

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/action-validation.ts packages/business/src/index.ts \
  apps/web/src/app/api/actions/[actionKey]/validate/route.ts

git commit -m "refactor: extract action validation to business layer (P11)"
```

---

## Task 3-B: settings/llm 레이어링 (가장 간단)

**파일:**
- Modify: `apps/web/src/app/api/settings/llm/route.ts` (29줄, prisma 0회)
- No business extraction needed (이미 모두 business로 위임)

**Interfaces:**
- Consumes: `getLlmSettingsStatus()`, `saveLlmSettings()` (both from @sangfor/business)
- Produces: (no changes — already delegated)

**Steps:**

- [ ] **Step 1: 현재 route 확인**

Expected: route가 이미 getLlmSettingsStatus/saveLlmSettings만 호출 중. prisma 직접 사용 0회 → 추출 불필요.

- [ ] **Step 2: route의 얇기 재검증**

```bash
wc -l apps/web/src/app/api/settings/llm/route.ts
```

Expected: 29줄 (확정)

- [ ] **Step 3: Commit 불필요**

Route가 이미 정확한 구조 → skip이거나 스타일 정리만.

---

## Task 3-C ~ 3-K: 나머지 8개 route

**일괄 구조 (각 task마다 동일):**

1. **route 현황 파악**: wc -l, grep prisma count, imports 확인
2. **business 함수 신설**: packages/business/src/[domain]-[operation].ts
3. **route 전환**: 기존 로직 제거 → business call로 변경
4. **typecheck**: 에러 확인
5. **Phase 0 스냅샷 검증** (mail-*관련): `pnpm test -- mail-candidates.test.ts` (분류 결과 동일)
6. **Commit**: "refactor: [description] (P11)"

**각 task별 세부:**

### 3-D: domain-pipeline (19줄, 2 prisma)
**Produces**: `extractDomainPipeline(companyId: string): Promise<DomainPipelineData>`
**Key logic**: Company → domain entities → pipeline stages 조회

### 3-E: mail-candidates/batch (58줄, 3 prisma)
**Produces**: `batchProcessMailCandidates(filters: BatchFilter): Promise<BatchResult>`
**Key logic**: mail_candidate 배치 조회 + bulk update
**Snapshot check**: YES

### 3-F: mail-candidates/cleanup (62줄, 5 prisma) + Nexias 특례
**Produces**: `cleanupMailCandidates(cutoffDate: Date): Promise<CleanupStats>`
**Key logic**: 오래된 candidate 정리 + **nexias 하드코딩 특례 처리** (별도 결정 필요 — 계획서 §11-D 참조)
**Snapshot check**: YES

### 3-G: modules/[moduleKey]/validate (117줄, 3 prisma)
**Produces**: `validateModule(moduleKey: string): Promise<ValidationReport>`
**Key logic**: action definition 검증 + 결과 저장
**Related**: 3-A (validateActionWithDb) 사용 가능

### 3-H: mail-insight-threads/generate (119줄, 6 prisma)
**Produces**: `generateInsightThreads(mailId: string): Promise<InsightResult>`
**Key logic**: mail 분석 → insight generation → DB 저장
**Snapshot check**: YES

### 3-I: dashboard/[role] (117줄, 13 prisma) — Phase 2 Task 6과 상호작용
**Produces**: `(이미 존재) calculateRoleDashboard(role, data)` (Phase 2 Task 6)
**Key logic**: role별 대시보드 데이터 → **Phase 2 산출물(role-dashboard.ts) 재사용**
**Refactor**: route에서 DB 조회 → role-dashboard 호출로 전환만

### 3-J: daily-report (61줄, 10 prisma)
**Produces**: `generateDailyReport(date: Date): Promise<ReportData>`
**Key logic**: 일일 보고서 데이터 조회/생성/전송

### 3-K: mail-candidates/convert (196줄, 25 prisma) — 최대 규모
**Produces**: `convertMailCandidateToEntity(candidateId: string): Promise<ConvertResult>`
**Key logic**: 메일 후보 → 실제 entity (customer/opportunity) 변환 (기존 `deriveEntityFromCandidate` 사용)
**Complexity**: 가장 복잡, DB 트랜잭션 포함
**Snapshot check**: YES (critical)

---

## Final Gate (Phase 3 완료 후)

- [ ] **모든 11개 route의 Commit 생성 확인**
  ```bash
  git log --oneline -11 refactor/phase-3-layering
  ```
  Expected: 11개 commit (3-A ~ 3-K)

- [ ] **전역 타입 검사**
  ```bash
  pnpm typecheck
  ```
  Expected: 0 errors

- [ ] **메일 분류 스냅샷 무변화** (Phase 0 보호)
  ```bash
  pnpm test -- mail-candidates.golden.test.ts
  ```
  Expected: all snapshots match (분류 결과 동일)

- [ ] **PR 생성**
  ```
  Title: refactor: Phase 3 — layering (web route → business)
  Body: 11개 route에서 비즈니스 로직 추출, route는 auth+parse+business+serialize만
  ```

---

## 의사결정 필요

| 항목 | 결정 | 기한 |
|---|---|---|
| **Nexias 특례** (3-F cleanup에서) | cleanup/route.ts의 nexias 도메인 하드코딩 처리 방침 (유지 vs 제거) | Task 3-F 시작 전 |
| **병렬 vs 순차** | 5개 opencode 세션 동시 vs 배치별 순차 | 즉시 (병렬 권장, worktree 분산 고려) |

---

## 참고

- **기존 business 함수 재사용**: role-dashboard (Phase 2 Task 6 산출물) 활용 (3-I)
- **Phase 2 의존성**: mail-domain-registry 등이 필요하면 Phase 2 merge 후 진행
- **Snapshot 보호**: mail-candidates 관련 4개 route (3-E, 3-F, 3-H, 3-K)는 Phase 0 golden snapshot 무변화 essential
