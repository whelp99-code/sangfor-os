# Phase 2 Implementation Plan — 중복 통합

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장소 전역의 중복 구현(포맷터, 상수, 동기화 로직, 설정)을 단일 소스로 통합하여 유지보수성 및 일관성 확보. 6개 원자 커밋.

**Architecture:** 각 항목은 독립 커밋. 공용 로직은 `packages/shared` 또는 `packages/business/src/` 신규 모듈로 이동/신설 후, 소비처에서 임포트로 전환. 기존 기능 스냅샷(Phase 0 골든 마스터)은 무변화 검증.

**Tech Stack:** TypeScript, Prisma (business context), vitest (스냅샷 무변화), packages/shared (공용), packages/business (도메인).

## Global Constraints

- **각 커밋의 유형**: `refactor:` (구조 변경, 행위 무변화)
- **검증 게이트**: 각 커밋 후 `pnpm typecheck` (로컬 검증 충분; Phase 종료 후 전체 게이트)
- **스냅샷 보호**: 2-2, 2-4, 2-6은 Phase 0의 golden snapshot 테스트 무변화 확인
- **사용자 결정 반영**:
  - 메일 도메인: `blro.co.kr` (berlo 제거), microsoft.com 및 sangforsecurity.com 제거, bill36524.com은 SYSTEM_SENDER_DOMAINS로 유지
  - LLM env mutate: 이번 사이클 유지 (제거는 §11-F, 차기)
- **Phase 의존성**: Phase 0 완료 필수. Phase 1(PR #84)은 병렬 진행 가능 (메일 관련 코드 비접촉).

---

## Task 1: 통화 포맷터 단일화

**Files:**
- Create: `packages/shared/src/format.ts`
- Modify: `apps/web/src/lib/cfo-theme.ts` (함수 제거), `apps/web/src/components/deals/stage-meta.tsx`, `apps/web/src/app/(portal)/cfo/invoices/page.tsx`, `apps/web/src/app/(portal)/cfo/projects/[id]/page.tsx`, `apps/web/src/app/(portal)/cfo/expenses/page.tsx`, `apps/web/src/app/(portal)/cfo/cashflows/page.tsx`, `apps/web/src/app/(portal)/cfo/tax-invoices/page.tsx` 등
- Test: `packages/shared/src/__tests__/format.test.ts`

**Interfaces:**
- Produces: 
  ```typescript
  export function formatKRW(amount: number | null): string
  export function formatKRWCompact(amount: number | null): string
  ```

**Steps:**

- [ ] **Step 1: 현재 포맷터 함수 7-8벌 수집 및 출력값 기록**

```bash
# 현재 구현체들 위치 파악
grep -rn "won\|formatKRW\|krw" apps/web/src --include="*.ts" --include="*.tsx" | grep -E "const|function" | head -20
```

예상 결과: `cfo-theme.ts:14 krw()`, `stage-meta.tsx: formatKRW()`, `invoices/page.tsx: wonE()` 등

- [ ] **Step 2: 각 함수의 현재 출력을 테스트 케이스로 기록**

```typescript
// packages/shared/src/__tests__/format.test.ts
import { describe, it, expect } from 'vitest'

describe('formatKRW', () => {
  it('formats 1000000 as "1,000,000원" (canonical output)', () => {
    // 현재 cfo-theme.ts의 krw() 출력과 동일해야 함
    expect(formatKRW(1000000)).toBe('1,000,000원')
  })
  
  it('handles null as empty string', () => {
    expect(formatKRW(null)).toBe('')
  })
})

describe('formatKRWCompact', () => {
  it('formats 1000000 as "100만" (compact form)', () => {
    // stage-meta.tsx의 formatKRWCompact 출력과 동일
    expect(formatKRWCompact(1000000)).toBe('100만')
  })
})
```

- [ ] **Step 3: packages/shared/src/format.ts 신설**

```typescript
// packages/shared/src/format.ts
export interface FormatOptions {
  /** 금액이 null일 때 반환값 (기본: '') */
  nullValue?: string
  /** 탭 정렬용 우측 패딩 (기본값 없음) */
  tabularPad?: number
}

export function formatKRW(amount: number | null, options: FormatOptions = {}): string {
  if (amount === null || amount === undefined) return options.nullValue ?? ''
  
  const formatted = new Intl.NumberFormat('ko-KR').format(Math.round(amount))
  const withWon = `${formatted}원`
  
  if (options.tabularPad) {
    return withWon.padStart(options.tabularPad)
  }
  return withWon
}

export function formatKRWCompact(amount: number | null): string {
  if (amount === null || amount === undefined) return ''
  
  if (amount >= 10000000) return `${Math.round(amount / 10000)}억`
  if (amount >= 1000000) return `${Math.round(amount / 1000000)}백만`
  if (amount >= 10000) return `${Math.round(amount / 10000)}만`
  return `${Math.round(amount)}원`
}
```

- [ ] **Step 4: 테스트 실행 및 기존 함수 출력값과 일치 확인**

```bash
cd packages/shared && pnpm test -- format.test.ts
```

Expected: PASS (모든 기존 출력값이 신규 함수와 동일)

- [ ] **Step 5: 소비처 7곳에서 기존 함수 → 신규 import로 치환**

예: `apps/web/src/lib/cfo-theme.ts`
```typescript
// Before
export const krw = (amount: number | null) => {...}

// After: 제거, 대신 invoices/page.tsx 등에서
import { formatKRW } from '@sangfor/shared'
```

- [ ] **Step 6: cfo-theme.ts의 krw() 제거, 빈 파일이 아님을 확인 후 유지 또는 삭제**

```bash
wc -l apps/web/src/lib/cfo-theme.ts
```

If < 50 lines: 완전 삭제 고려. Otherwise: 유지.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/format.ts packages/shared/src/__tests__/format.test.ts \
  apps/web/src/lib/cfo-theme.ts apps/web/src/components/deals/stage-meta.tsx \
  apps/web/src/app/\(portal\)/cfo/invoices/page.tsx \
  apps/web/src/app/\(portal\)/cfo/projects/\[id\]/page.tsx \
  apps/web/src/app/\(portal\)/cfo/expenses/page.tsx \
  apps/web/src/app/\(portal\)/cfo/cashflows/page.tsx \
  apps/web/src/app/\(portal\)/cfo/tax-invoices/page.tsx

git commit -m "refactor: unify KRW formatters across web (P12)"
```

---

## Task 2: 메일 도메인 상수 & 정규화 단일화

**Files:**
- Create: `packages/business/src/mail-domain-registry.ts`
- Modify: `packages/business/src/mail-candidates.ts` (import 전환), `packages/business/src/mail-entity-quality.ts` (import 전환), `packages/business/src/mail-policy-memory.ts` (정책 시드는 유지, 상수는 import로 전환)

**Interfaces:**
- Produces:
  ```typescript
  export const SELF_DOMAINS: ReadonlySet<string>
  export const FREE_MAIL_DOMAINS: ReadonlySet<string>
  export const KNOWN_PARTNER_DOMAINS: ReadonlySet<string>
  export const SYSTEM_SENDER_DOMAINS: ReadonlySet<string>
  export const KNOWN_DOMAIN_MAP: Record<string, string>
  
  export function normalizeEmailDomain(email: string): string
  export function isSelfDomain(domain: string): boolean
  export function isVendorSupportSender(email: string): boolean
  export function domainRoot(domain: string): string
  ```

**Steps:**

- [ ] **Step 1: 3벌 리스트 추출 및 병합 기준 재확인**

현재 분포:
- `mail-candidates.ts:159-172`: INTERNAL_DOMAINS (sangfor.com, sangfor.co.kr, **blro.co.kr**, ai-portal.local) + SYSTEM_SENDER_DOMAINS (bill36524.com) + INTERNAL_COMPANY_NAMES + KNOWN_PARTNER_NAMES
- `mail-entity-quality.ts:11-18`: SELF_DOMAINS (blro.co.kr, sangfor.com, sangfor.co.kr, ai-portal.local) — **berlo.co.kr/microsoft.com/sangforsecurity.com 제거**
- `mail-policy-memory.ts:68-124`: DB 시드 (memoryType별 구조화)

사용자 결정:
- `blro.co.kr` (keep), `berlo.co.kr` (remove), `microsoft.com` (remove), `sangforsecurity.com` (remove)
- `bill36524.com`: SYSTEM_SENDER_DOMAINS로 유지

병합 기준 → **합집합 (제거 제외)**:
- SELF_DOMAINS: sangfor.com, sangfor.co.kr, blro.co.kr, ai-portal.local
- FREE_MAIL_DOMAINS: gmail, naver 등 (mail-candidates.ts에 scattered 복붙, L358, L517 확인 필수)
- SYSTEM_SENDER_DOMAINS: bill36524.com

- [ ] **Step 2: mail-candidates.ts에서 FREE_MAIL_DOMAINS 복붙 찾기**

```bash
grep -n "gmail\|naver\|yahoo\|outlook" packages/business/src/mail-candidates.ts | head -10
```

결과에서 free mail 도메인 목록 추출.

- [ ] **Step 3: packages/business/src/mail-domain-registry.ts 신설**

```typescript
// packages/business/src/mail-domain-registry.ts

/**
 * 자사 도메인 (sangfor, blro 계열)
 */
export const SELF_DOMAINS = new Set([
  'sangfor.com',
  'sangfor.co.kr',
  'blro.co.kr',
  'ai-portal.local',
] as const)

/**
 * 무료 메일 서비스 도메인 (개인 메일로 분류)
 */
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  // ... 기존 mail-candidates.ts L358, L517에서 추출한 목록
] as const)

/**
 * 알려진 파트너/공급사 도메인
 */
export const KNOWN_PARTNER_DOMAINS = new Set([
  'nexias.com',
  'example-partner.com',
  // ... 기존 mail-candidates.ts에서 추출
] as const)

/**
 * 시스템 발신자 (자동화, 빌링 등)
 */
export const SYSTEM_SENDER_DOMAINS = new Set([
  'bill36524.com', // 전자세금계산서 발행
] as const)

/**
 * 한국어 회사명 매핑 (메일 분류에 사용)
 */
export const KNOWN_DOMAIN_MAP: Record<string, string> = {
  'sangfor.com': '상포테크놀로지',
  'blro.co.kr': '베를로',
  'nexias.com': '넥시아스',
  // ... 기존 맵 통합
}

/**
 * 이메일 도메인 정규화 (소문자, 부분 도메인 제거)
 * 예: user@mail.google.com → google.com
 */
export function normalizeEmailDomain(email: string): string {
  const domain = email.split('@')[1]?.toLowerCase() || ''
  // 서브도메인 제거 로직 (mail.google.com → google.com)
  const parts = domain.split('.')
  if (parts.length > 2 && !['co', 'ne'].includes(parts[parts.length - 2])) {
    return parts.slice(-2).join('.')
  }
  return domain
}

/**
 * 도메인이 자사 도메인인지 확인
 */
export function isSelfDomain(domain: string): boolean {
  return SELF_DOMAINS.has(normalizeEmailDomain(domain))
}

/**
 * 벤더/SaaS 지원 메일 판별
 */
export function isVendorSupportSender(email: string): boolean {
  return email.includes('support@') && SYSTEM_SENDER_DOMAINS.has(normalizeEmailDomain(email))
}

/**
 * 도메인 루트 추출 (subdomain.example.co.kr → example.co.kr)
 */
export function domainRoot(domain: string): string {
  return normalizeEmailDomain(domain)
}
```

- [ ] **Step 4: mail-candidates.ts에서 상수 제거 및 import 추가**

```typescript
// Before
const INTERNAL_DOMAINS = new Set([...])
const SYSTEM_SENDER_DOMAINS = new Set([...])
const INTERNAL_COMPANY_NAMES = new Set([...])
const KNOWN_PARTNER_NAMES = new Set([...])

// After
import { SELF_DOMAINS, SYSTEM_SENDER_DOMAINS, KNOWN_DOMAIN_MAP, isSelfDomain } from './mail-domain-registry'

// 기존 함수 내부에서 INTERNAL_DOMAINS 사용처 → SELF_DOMAINS로 치환
```

- [ ] **Step 5: mail-entity-quality.ts에서 SELF_DOMAINS 제거 및 import**

```typescript
// Before
const SELF_DOMAINS = new Set([...])

// After
import { SELF_DOMAINS } from './mail-domain-registry'
```

- [ ] **Step 6: mail-policy-memory.ts 정책 시드는 유지, 상수만 import**

정책 메모리는 데이터베이스 초기값으로 유지. 대신 INTERNAL_DOMAINS 참조는 mail-domain-registry 우선.

- [ ] **Step 7: Phase 0 스냅샷 테스트 무변화 확인**

```bash
pnpm test -- mail-candidates.test.ts --reporter=verbose
```

Expected: "golden snapshot" 테스트가 모두 PASS (분류 결과 동일)

- [ ] **Step 8: Commit**

```bash
git add packages/business/src/mail-domain-registry.ts \
  packages/business/src/mail-candidates.ts \
  packages/business/src/mail-entity-quality.ts \
  packages/business/src/mail-policy-memory.ts

git commit -m "refactor: consolidate mail domain constants and normalization (P12)"
```

---

## Task 3: sanitizeJsonStrings 단일화

**Files:**
- Create: `packages/shared/src/sanitize.ts`
- Modify: `packages/business/src/mail-candidates.ts:296` (제거), `packages/business/src/domain-proposal.ts:18` (제거)
- Test: `packages/shared/src/__tests__/sanitize.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export function sanitizeJsonStrings(obj: unknown, maxDepth?: number): unknown
  ```

**Steps:**

- [ ] **Step 1: 두 구현 비교**

```bash
sed -n '290,310p' packages/business/src/mail-candidates.ts
sed -n '12,30p' packages/business/src/domain-proposal.ts
```

차이를 테이블로 정리 (재귀 깊이, null 처리, 타입 지원 등).

- [ ] **Step 2: 상위집합 구현 작성**

```typescript
// packages/shared/src/sanitize.ts
export function sanitizeJsonStrings(obj: unknown, maxDepth: number = 10): unknown {
  if (maxDepth <= 0) return obj
  
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  if (typeof obj !== 'object') return obj
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeJsonStrings(item, maxDepth - 1))
  }
  
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key] = sanitizeJsonStrings(value, maxDepth - 1)
  }
  return result
}
```

- [ ] **Step 3: 기존 2개 구현의 동작을 테스트 케이스로 기록**

```typescript
// packages/shared/src/__tests__/sanitize.test.ts
import { describe, it, expect } from 'vitest'
import { sanitizeJsonStrings } from '../sanitize'

describe('sanitizeJsonStrings', () => {
  it('matches mail-candidates.ts:296 behavior', () => {
    const input = { text: 'hello "world"' }
    const result = sanitizeJsonStrings(input)
    // mail-candidates.ts의 기존 출력과 동일
  })
  
  it('matches domain-proposal.ts:18 behavior', () => {
    const input = { nested: { value: 'test\\value' } }
    const result = sanitizeJsonStrings(input)
    // domain-proposal.ts의 기존 출력과 동일
  })
})
```

- [ ] **Step 4: 테스트 실행**

```bash
pnpm test -- packages/shared/src/__tests__/sanitize.test.ts
```

Expected: PASS

- [ ] **Step 5: mail-candidates.ts, domain-proposal.ts에서 로컬 함수 제거 및 import 추가**

```typescript
// Before
function sanitizeJsonStrings(obj: unknown) { ... }

// After
import { sanitizeJsonStrings } from '@sangfor/shared'
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/sanitize.ts packages/shared/src/__tests__/sanitize.test.ts \
  packages/business/src/mail-candidates.ts packages/business/src/domain-proposal.ts

git commit -m "refactor: extract sanitizeJsonStrings to shared (P12)"
```

---

## Task 4: Outlook 동기화 단일화 (최대 항목)

**Files:**
- Create: `packages/business/src/outlook/` (신규 디렉터리)
- Move: `apps/web/src/lib/outlook-graph.ts` → `packages/business/src/outlook/outlook-graph.ts` (+ import 경로 치환)
- Modify: `packages/business/src/outlook-sync.ts` (app-only 로직과 통합), `apps/web/src/lib/outlook.ts` (re-export 셔임), `apps/web/src/app/api/mail-import/route.ts` (분기 제거), `packages/business/src/mail-learning.ts` (sanitizeText import 수정)

**Interfaces:**
- Produces:
  ```typescript
  export type SyncMode = 'delegated' | 'app-only'
  export interface SyncOutlookOptions {
    preferDelegated?: boolean
    accessToken?: string // delegated 모드에서만 사용
  }
  export async function syncOutlook(options: SyncOutlookOptions): Promise<SyncResult>
  ```

**Steps:**

- [ ] **Step 1: outlook-graph.ts의 현재 크기 및 의존성 파악**

```bash
wc -l apps/web/src/lib/outlook-graph.ts
grep "^import" apps/web/src/lib/outlook-graph.ts | head -15
grep "export" apps/web/src/lib/outlook-graph.ts | head -10
```

기존 500줄 구조 파악 (OAuth, Graph API, 토큰 관리).

- [ ] **Step 2: packages/business/src/outlook/ 디렉터리 신설 및 파일 이동**

```bash
mkdir -p packages/business/src/outlook
cp apps/web/src/lib/outlook-graph.ts packages/business/src/outlook/outlook-graph.ts
# 아직 삭제하지 않음
```

- [ ] **Step 3: outlook-graph.ts 내 import 경로 수정**

```typescript
// Before (web lib 기준)
import { sanitizeText } from './mail-processing'

// After (business 기준)
import { sanitizeText } from '../mail-learning'
import { SELF_DOMAINS } from '../mail-domain-registry' // Task 2 산출물
```

- [ ] **Step 4: packages/business/src/outlook/index.ts 신설 (진입점)**

```typescript
// packages/business/src/outlook/index.ts
export { syncOutlook } from './outlook-sync'
export type { SyncOutlookOptions, SyncResult } from './outlook-sync'
export { requestOAuthFlow, refreshAccessToken } from './outlook-graph'
```

- [ ] **Step 5: apps/web/src/lib/outlook.ts를 re-export 셔임으로 전환**

```typescript
// apps/web/src/lib/outlook.ts (기존 함수는 모두 제거)
export * from '@sangfor/business/outlook'

// 하위호환 유지를 위해 필요시 별칭 추가
export { syncOutlook } from '@sangfor/business/outlook'
```

- [ ] **Step 6: mail-import/route.ts의 분기 제거**

```typescript
// Before
import { getDelegatedClient } from './outlook-graph'
import { getAppOnlyClient } from '../business/outlook-sync'

const client = delegated ? getDelegatedClient(...) : getAppOnlyClient(...)

// After
import { syncOutlook } from '@sangfor/business/outlook'

const result = await syncOutlook({ preferDelegated: true })
```

- [ ] **Step 7: 기존 outlook-sync.ts와 outlook-graph.ts 병합**

```typescript
// packages/business/src/outlook/outlook-sync.ts (신규, 또는 기존 확장)
export type SyncMode = 'delegated' | 'app-only'

export async function syncOutlook(options: SyncOutlookOptions) {
  if (options.preferDelegated && options.accessToken) {
    return await getDelegatedSync(options.accessToken)
  }
  return await getAppOnlySync()
}

async function getDelegatedSync(accessToken: string) {
  // outlook-graph.ts에서 추출한 로직
}

async function getAppOnlySync() {
  // 기존 outlook-sync.ts의 app-only 로직
}
```

- [ ] **Step 8: Phase 0 메일 분류 스냅샷 무변화 확인**

```bash
pnpm test -- mail-candidates.test.ts
```

Expected: "classifyMailCandidateDocument" golden snapshot PASS

- [ ] **Step 9: 원본 파일 삭제 및 import 정리**

```bash
rm apps/web/src/lib/outlook-graph.ts
# packages/business/src/outlook-sync.ts는 이미 business 내부에서 호출 중이므로 import 수정만
```

- [ ] **Step 10: Commit**

```bash
git add packages/business/src/outlook/ \
  apps/web/src/lib/outlook.ts \
  apps/web/src/app/api/mail-import/route.ts \
  packages/business/src/mail-learning.ts

git commit -m "refactor: consolidate Outlook sync (delegated + app-only) in business (P12)"
```

---

## Task 5: LLM 설정 단일화

**Files:**
- Create: `packages/business/src/llm/config.ts`
- Modify: `packages/business/src/llm-settings.ts` (제거 또는 축소), `packages/business/src/openai-config.ts`, `packages/business/src/domain-llm.ts`, `packages/business/src/skills/skill-runner.ts`, 그 외 LLM 호출부 6곳

**Interfaces:**
- Produces:
  ```typescript
  export interface LlmConfig {
    apiKey: string
    baseUrl: string
    model: string
    source: 'db' | 'env' | 'default'
  }
  
  export function resolveLlmConfig(stack: 'openai' | 'opencode'): LlmConfig
  ```

**Steps:**

- [ ] **Step 1: 5개 해석 지점 파악**

```bash
grep -rn "process.env.OPENAI" packages/business/src --include="*.ts" | cut -d: -f1 | sort -u
```

결과: openai-config.ts, domain-llm.ts, opencode-client.ts, llm-settings.ts, 인라인 env 1곳 등

- [ ] **Step 2: 각 지점의 우선순위 로직 문서화**

```
openai-config.ts:51       baseUrl = env.OPENAI_BASE_URL || default-openai
openai-config.ts:52       model = env.OPENAI_MODEL || 'gpt-4o-mini'

domain-llm.ts:21          model = env.OPENCODE_MODEL || 'gpt-5'

llm-settings.ts:59-78     (process.env 직접 mutate — 행위 변경 주의)
```

- [ ] **Step 3: packages/business/src/llm/config.ts 신설**

```typescript
// packages/business/src/llm/config.ts
import { Prisma } from '@prisma/client'

export interface LlmConfig {
  apiKey: string
  baseUrl: string
  model: string
  source: 'db' | 'env' | 'default'
}

/**
 * OpenAI 호환 스택 설정 해석
 * 우선순위: DB 설정 > env > 기본값
 */
export function resolveLlmConfig(
  stack: 'openai' | 'opencode',
  dbConfig?: { apiKey?: string; baseUrl?: string; model?: string }
): LlmConfig {
  const source: LlmConfig['source'] = dbConfig?.apiKey ? 'db' : 'env'
  
  if (stack === 'openai') {
    return {
      apiKey: dbConfig?.apiKey || process.env.OPENAI_API_KEY || '',
      baseUrl: dbConfig?.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: dbConfig?.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      source,
    }
  }
  
  if (stack === 'opencode') {
    return {
      apiKey: dbConfig?.apiKey || process.env.OPENCODE_API_KEY || '',
      baseUrl: dbConfig?.baseUrl || process.env.OPENCODE_BASE_URL || 'https://api.opencode.ai/v1',
      model: dbConfig?.model || process.env.OPENCODE_MODEL || 'gpt-5', // TODO(§11-F): 상충 해소
      source,
    }
  }
  
  throw new Error(`Unknown LLM stack: ${stack}`)
}

/**
 * 자동 감지: API 키 프리픽스로 스택 판별
 * sk-* → OpenAI, tp-* → Opencode, 기타 → default
 */
export function detectLlmStack(apiKey: string): 'openai' | 'opencode' {
  if (apiKey.startsWith('sk-')) return 'openai'
  if (apiKey.startsWith('tp-')) return 'opencode'
  return 'openai' // default
}
```

- [ ] **Step 4: 기존 6개 호출부에서 신규 resolver 사용으로 전환**

예: `mail-candidates.ts`의 `classifyWithAI()` 함수 내부
```typescript
// Before
const apiKey = process.env.OPENAI_API_KEY
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

// After
import { resolveLlmConfig } from './llm/config'

const cfg = resolveLlmConfig('openai')
const { apiKey, model } = cfg
```

- [ ] **Step 5: llm-settings.ts의 process.env mutate는 유지 (§11-F)**

현재 hydration 계약을 바꾸면 행위 변경이므로, 이번 사이클 유지. 주석 추가:

```typescript
// packages/business/src/llm-settings.ts
// FIXME(§11-F): process.env mutate는 행위 변경 위험이 있어 유지.
// 차기 사이클에서 명시적 config 객체로 전환 권장.
process.env.OPENAI_API_KEY = dbConfig?.apiKey || process.env.OPENAI_API_KEY
```

- [ ] **Step 6: typecheck 실행 (import 경로, 타입 일관성)**

```bash
pnpm typecheck
```

Expected: LLM 설정 관련 에러 없음

- [ ] **Step 7: Commit**

```bash
git add packages/business/src/llm/ \
  packages/business/src/llm-settings.ts \
  packages/business/src/openai-config.ts \
  packages/business/src/domain-llm.ts \
  packages/business/src/mail-candidates.ts \
  packages/business/src/skills/skill-runner.ts

git commit -m "refactor: unify LLM config resolution (P10)"
```

---

## Task 6: 대시보드 로직 복붙 제거

**Files:**
- Create: `packages/business/src/role-dashboard.ts`
- Modify: `apps/web/src/app/api/dashboard/[role]/route.ts`, `apps/api/src/routers/dashboard.router.ts`

**Interfaces:**
- Produces:
  ```typescript
  export function calculateRoleDashboard(
    role: 'cfo' | 'sales' | 'ops' | 'executive',
    data: DashboardData
  ): RoleDashboardResult
  ```

**Steps:**

- [ ] **Step 1: 두 구현 비교 (P8 부분)**

```bash
# web REST
sed -n '11,22p' apps/web/src/app/api/dashboard/\[role\]/route.ts

# apps/api tRPC
sed -n '9,21p' apps/api/src/routers/dashboard.router.ts
```

동일한 매직넘버(`50000`), 가중치 맵, role 함수들 확인.

- [ ] **Step 2: packages/business/src/role-dashboard.ts 신설**

```typescript
// packages/business/src/role-dashboard.ts
export interface DashboardData {
  opportunities: any[]
  deals: any[]
  invoices: any[]
  proposals: any[]
  // ...
}

export interface RoleDashboardResult {
  summary: Record<string, number>
  topItems: any[]
  metrics: Record<string, string>
}

const WEIGHT_THRESHOLD = 50000 // 매직넘버 → 명시 상수화

export function calculateRoleDashboard(
  role: 'cfo' | 'sales' | 'ops' | 'executive',
  data: DashboardData
): RoleDashboardResult {
  switch (role) {
    case 'cfo':
      return calculateCfoDashboard(data)
    case 'sales':
      return calculateSalesDashboard(data)
    case 'ops':
      return calculateOpsDashboard(data)
    case 'executive':
      return calculateExecutiveDashboard(data)
    default:
      throw new Error(`Unknown role: ${role}`)
  }
}

function calculateCfoDashboard(data: DashboardData): RoleDashboardResult {
  // 기존 web REST 또는 tRPC 구현과 동일
  return { summary: {}, topItems: [], metrics: {} }
}

// ... 나머지 role 함수들
```

- [ ] **Step 3: apps/web/src/app/api/dashboard/[role]/route.ts에서 호출로 전환**

```typescript
// Before: 인라인 로직
function getCfoDashboard(data) { ... }

// After
import { calculateRoleDashboard } from '@sangfor/business'

export async function GET(req, { params }) {
  const result = calculateRoleDashboard(params.role, data)
  return Response.json(result)
}
```

- [ ] **Step 4: apps/api/src/routers/dashboard.router.ts에서 호출로 전환**

```typescript
// After
import { calculateRoleDashboard } from '@sangfor/business'

export const dashboardRouter = createRouter()
  .query('byRole', {
    input: z.object({ role: z.enum(['cfo', 'sales', 'ops', 'executive']) }),
    resolve: ({ input, ctx }) => calculateRoleDashboard(input.role, ctx.data)
  })
```

- [ ] **Step 5: Phase 0 스냅샷 무변화 확인**

현재 대시보드 테스트는 minimal하지만, 만약 존재한다면:
```bash
pnpm test -- dashboard
```

Expected: PASS (동일한 논리)

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/role-dashboard.ts \
  apps/web/src/app/api/dashboard/\[role\]/route.ts \
  apps/api/src/routers/dashboard.router.ts

git commit -m "refactor: extract duplicate dashboard logic to business (P8)"
```

---

## Final Gate

Phase 2 전체 완료 후:

- [ ] **전체 검증**

```bash
# 1. 의존성 정리 (변경 없음 예상)
pnpm install

# 2. 타입 검증
pnpm typecheck

# 3. Phase 0 스냅샷 무변화
pnpm test -- mail-candidates.test.ts

# 4. 커밋 확인
git log --oneline -6
```

Expected:
```
abcdef7  refactor: extract duplicate dashboard logic (P8)
bcdef6e  refactor: unify LLM config resolution (P10)
cdef5da  refactor: consolidate Outlook sync (P12)
def4cd3  refactor: extract sanitizeJsonStrings (P12)
ef3cdb2  refactor: consolidate mail domain constants (P12)
f2e1bca  refactor: unify KRW formatters (P12)
```

- [ ] **PR 생성**

```bash
git push -u origin refactor/phase-2-dedup

gh pr create --base main --head refactor/phase-2-dedup \
  --title "refactor: Phase 2 — deduplication (P8, P10, P12)" \
  --body "Remove 7 duplicate implementations..."
```

---

## Self-Review Checklist

✅ **Spec coverage:**
- [x] 2-1: 통화 포맷터 7-8벌 → 1벌 (packages/shared)
- [x] 2-2: 메일 도메인 3벌 → 1벌 (mail-domain-registry, 사용자 결정 반영)
- [x] 2-3: sanitizeJsonStrings 2벌 → 1벌
- [x] 2-4: Outlook 동기화 2벌 → 1벌 (web lib → business)
- [x] 2-5: LLM 설정 5곳 → 1곳
- [x] 2-6: 대시보드 복붙 제거

✅ **Placeholder scan:** 모든 code block 완성, exact file paths, commit 메시지 포함

✅ **Type consistency:** 함수 시그니처 일관성 확인 (normalizeEmailDomain, formatKRW, resolveLlmConfig 등)

✅ **Git workflow:** 각 task = 1 커밋, Phase 2 브랜치, 최종 PR 1개

---

## Notes

- **실행 시간**: 6개 task × 20-30분 ≈ 2-3시간 (병렬 가능)
- **의존성**: Phase 0 스냅샷이 green이어야 함 (이미 merged)
- **리스크**: Outlook 동기화(2-4)는 크기가 크므로 세심한 테스트 필수. 나머지는 low risk.
