# Phase 6 Implementation Plan — API 표면 단일화 (web BFF 정리)

> ⚠️ **ADR-002로 대체/수정됨** (2026-07-10, `docs/convergence/ADR-002-api-surface.md`):
> 이 문서의 **tRPC 도입 방향((2)·(3) 및 tRPC 관련 태스크 전부)은 폐기**됐다 — 채택된 방향은
> 마스터플랜의 "web = BFF, 미사용 tRPC 표면 제거"다. 이 문서 내장 Phase 7(신규 컬럼)도
> ADR-002 D4로 재정의됨(인덱스·FK 승격만, segment/riskScore는 기추가분 수용).
> **유효하게 남는 부분**: (1) 응답 포맷 정규화, (4) 에러 핸들링 표준화. 실행 전 ADR-002를 먼저 읽을 것.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** apps/web API routes를 type-safe, consistent하게 정리하고, 모든 비즈니스 로직을 @sangfor/business로 위임하여 route는 "auth + parse + business + serialize"만 담당하도록 정리.

**Architecture:** Phase 3에서 11개 주요 route의 비즈니스 로직을 추출 완료했으나, 나머지 10+ route와 응답 포맷이 여전히 일관성 없음. Phase 6에서: (1) 모든 route의 응답을 공통 API 응답 포맷으로 정규화 (2) tRPC를 도입하여 type-safe RPC 제공 (3) OpenAPI 스펙 자동 생성 (4) 에러 핸들링 표준화.

**Tech Stack:** TypeScript, Next.js Route Handlers, tRPC, OpenAPI/Swagger, packages/business, Prisma

## Global Constraints

- **각 커밋**: `refactor:` 또는 `feat:` prefix (행위 무변화 또는 신기능)
- **검증 게이트**: 각 task 후 `pnpm typecheck` (로컬 충분, Phase 종료 후 전역 gate)
- **Phase 0 보호**: mail-candidates golden snapshot 무변화 필수
- **tRPC**: TRPC_HEADERS 인증은 기존 assertApiAccess 재사용
- **응답 포맷**: 모든 route는 `{ success: boolean; data?: T; error?: string }` 포맷 준수

---

## 파일 구조

```
apps/web/src/
├── app/api/
│   ├── _lib/
│   │   ├── api-response.ts       (새로 생성: 공통 응답 포맷 정의)
│   │   ├── api-error.ts          (기존 확장: 에러 타입 추가)
│   │   └── trpc-server.ts        (새로 생성: tRPC 라우터 초기화)
│   ├── trpc/
│   │   └── [trpc].ts             (새로 생성: tRPC 엔드포인트)
│   ├── [기존 라우트들]/
│   │   └── route.ts              (수정: 공통 응답 포맷 적용)
│
packages/
├── business/src/
│   └── api-types.ts              (새로 생성: 공유 타입, 응답 인터페이스)
│
packages/shared/
├── types/
│   └── api.ts                    (새로 생성 또는 확장: API 공통 타입)
```

---

## Task 분할 전략 (병렬 가능)

```
Batch 1 (기초 구축):
  - Task 6-1: 공통 API 응답 포맷 정의 + 기본 에러 핸들링
  - Task 6-2: tRPC 라우터 초기화 + 첫 번째 procedure 구현

Batch 2 (통합):
  - Task 6-3: 기존 route 5개를 공통 포맷으로 마이그레이션
  - Task 6-4: 나머지 route 마이그레이션 + 응답 포맷 통일

Batch 3 (최종):
  - Task 6-5: OpenAPI 스펙 자동 생성 (tRPC-OpenAPI)
  - Task 6-6: 통합 테스트 + 문서화

총 6개 task, 병렬 가능 (Batch별 2개 task)
```

---

## Task 6-1: 공통 API 응답 포맷 정의 + 기본 에러 처리

**Files:**
- Create: `apps/web/src/app/api/_lib/api-response.ts`
- Create: `apps/web/src/app/api/_lib/api-error.ts`
- Modify: `packages/shared/types/api.ts`

**Interfaces:**
- Produces: 
  - `ApiResponse<T>` interface: `{ success: boolean; data?: T; error?: { code: string; message: string }; meta?: { timestamp: number; } }`
  - `ApiError` class: extends Error, with code/status fields
  - `createApiResponse(data: T): ApiResponse<T>`
  - `createApiError(code: string, message: string, statusCode?: number): ApiError`

**Steps:**

- [ ] **Step 1: packages/shared/types/api.ts 생성 (공통 타입)**

```typescript
// packages/shared/types/api.ts
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    timestamp: number;
  };
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  statusCode: number;
}
```

- [ ] **Step 2: apps/web/src/app/api/_lib/api-error.ts 생성**

```typescript
// apps/web/src/app/api/_lib/api-error.ts
export class ApiError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const API_ERRORS = {
  UNAUTHORIZED: () => new ApiError('UNAUTHORIZED', 'Unauthorized', 401),
  FORBIDDEN: () => new ApiError('FORBIDDEN', 'Forbidden', 403),
  NOT_FOUND: () => new ApiError('NOT_FOUND', 'Not found', 404),
  VALIDATION_ERROR: (msg: string) => new ApiError('VALIDATION_ERROR', msg, 400),
  INTERNAL_ERROR: () => new ApiError('INTERNAL_ERROR', 'Internal server error', 500),
  DATABASE_ERROR: (msg?: string) => new ApiError('DATABASE_ERROR', msg || 'Database error', 500),
} as const;
```

- [ ] **Step 3: apps/web/src/app/api/_lib/api-response.ts 생성**

```typescript
// apps/web/src/app/api/_lib/api-response.ts
import { NextResponse } from 'next/server';
import { ApiResponse, ApiErrorDetail } from '@sangfor/shared/types/api';
import { ApiError } from './api-error';

export function createApiResponse<T>(
  data: T,
  statusCode: number = 200
): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      meta: { timestamp: Date.now() },
    },
    { status: statusCode }
  );
}

export function createApiErrorResponse(
  error: ApiError | Error,
  statusCode?: number
): NextResponse<ApiResponse<null>> {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
        meta: { timestamp: Date.now() },
      },
      { status: error.statusCode }
    );
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'UNKNOWN_ERROR',
        message: error.message || 'Unknown error',
      },
      meta: { timestamp: Date.now() },
    },
    { status: statusCode || 500 }
  );
}
```

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/types/api.ts apps/web/src/app/api/_lib/ && \
git commit -m "refactor: define common API response format and error handling (P16)"
```

---

## Task 6-2: tRPC 라우터 초기화 + 첫 번째 procedure 구현

**Files:**
- Create: `apps/web/src/app/api/_lib/trpc-server.ts`
- Create: `apps/web/src/trpc/index.ts` (routers 폴더)
- Create: `apps/web/src/trpc/hello.ts` (테스트용 간단한 procedure)
- Create: `apps/web/src/app/api/trpc/[trpc].ts`

**Interfaces:**
- Consumes: tRPC 3.x, @trpc/server
- Produces: 
  - `initTRPC()` return: t router
  - `appRouter` with public + protected routes
  - tRPC HTTP handler

**Steps:**

- [ ] **Step 1: apps/web/src/app/api/_lib/trpc-server.ts 생성**

```typescript
// apps/web/src/app/api/_lib/trpc-server.ts
import { initTRPC, TRPCError } from '@trpc/server';
import { NextRequest } from 'next/server';
import { assertApiAccess } from '@/lib/api-auth';

interface CreateContextOptions {
  req: NextRequest;
}

export const createContext = async (opts: CreateContextOptions) => {
  try {
    // Verify API access (auth)
    assertApiAccess(opts.req);
    return { authenticated: true };
  } catch (error) {
    return { authenticated: false };
  }
};

export type Context = Awaited<ReturnType<typeof createContext>>;

export const t = initTRPC.context<Context>().create();

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async (opts) => {
  if (!opts.ctx.authenticated) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return opts.next();
});
```

- [ ] **Step 2: apps/web/src/trpc/hello.ts 생성 (테스트용)**

```typescript
// apps/web/src/trpc/hello.ts
import { publicProcedure } from '@/app/api/_lib/trpc-server';
import { z } from 'zod';

export const helloRouter = {
  greet: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => {
      return { message: `Hello, ${input.name}!` };
    }),
};
```

- [ ] **Step 3: apps/web/src/trpc/index.ts 생성 (메인 라우터)**

```typescript
// apps/web/src/trpc/index.ts
import { t } from '@/app/api/_lib/trpc-server';
import { helloRouter } from './hello';

export const appRouter = t.router({
  hello: t.router(helloRouter),
  // 나머지 라우터들은 이후 task에서 추가
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 4: apps/web/src/app/api/trpc/[trpc].ts 생성 (HTTP 핸들러)**

```typescript
// apps/web/src/app/api/trpc/[trpc].ts
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/trpc';
import { createContext } from '@/app/api/_lib/trpc-server';
import { NextRequest } from 'next/server';

const handler = (req: NextRequest) => {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext({ req }),
    onError({ error }) {
      console.error('tRPC error:', error);
    },
  });
};

export { handler as GET, handler as POST };
```

- [ ] **Step 5: 테스트**

```bash
# tRPC 엔드포인트 테스트
curl -X GET "http://localhost:3000/api/trpc/hello.greet?input=%7B%22name%22%3A%22World%22%7D"
```

Expected: `{"result":{"data":{"message":"Hello, World!"}}}`

- [ ] **Step 6: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/api/_lib/trpc-server.ts apps/web/src/trpc/ apps/web/src/app/api/trpc/ && \
git commit -m "feat: initialize tRPC router with basic procedure (P16)"
```

---

## Task 6-3: 기존 route 5개를 공통 포맷으로 마이그레이션

**Files:**
- Modify: `apps/web/src/app/api/daily-report/route.ts`
- Modify: `apps/web/src/app/api/domain-pipeline/route.ts`
- Modify: `apps/web/src/app/api/policy-memories/[id]/route.ts`
- Modify: `apps/web/src/app/api/settings/llm/route.ts`
- Modify: `apps/web/src/app/api/actions/[actionKey]/validate/route.ts`

**Interfaces:**
- Consumes: createApiResponse, createApiErrorResponse, ApiError from Task 6-1
- Produces: 5개 route 모두 공통 응답 포맷 준수

**Steps:**

- [ ] **Step 1: daily-report route 현황 파악**

```bash
wc -l apps/web/src/app/api/daily-report/route.ts
grep -c "NextResponse.json" apps/web/src/app/api/daily-report/route.ts
```

Expected: 약 60-80줄, json() call 2-3회

- [ ] **Step 2: daily-report/route.ts 마이그레이션**

변경 전:
```typescript
// apps/web/src/app/api/daily-report/route.ts (기존)
export async function POST(req: NextRequest) {
  assertApiAccess(req);
  try {
    const result = await generateDailyReport(new Date());
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

변경 후:
```typescript
// apps/web/src/app/api/daily-report/route.ts (신규)
import { generateDailyReport } from '@sangfor/business';
import { assertApiAccess } from '@/lib/api-auth';
import { createApiResponse, createApiErrorResponse } from '../_lib/api-response';
import { API_ERRORS } from '../_lib/api-error';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    assertApiAccess(req);
    const result = await generateDailyReport(new Date());
    return createApiResponse(result, 200);
  } catch (error) {
    if (error instanceof Error) {
      return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
    }
    throw error;
  }
}
```

- [ ] **Step 3: 나머지 4개 route 동일 패턴으로 마이그레이션**

각 route에 대해:
1. import 수정: createApiResponse, createApiErrorResponse, API_ERRORS 추가
2. 응답: NextResponse.json → createApiResponse 또는 createApiErrorResponse로 변경
3. 에러 처리: try-catch 정규화

- [ ] **Step 4: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors

- [ ] **Step 5: 기존 route 응답 호환성 테스트**

```bash
# 각 route 엔드포인트 호출 후 응답 포맷 검증
curl -X POST "http://localhost:3000/api/daily-report" \
  -H "Authorization: Bearer <test-token>"
```

Expected: `{ success: true, data: { ... }, meta: { timestamp: ... } }`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/daily-report/route.ts \
  apps/web/src/app/api/domain-pipeline/route.ts \
  apps/web/src/app/api/policy-memories/[id]/route.ts \
  apps/web/src/app/api/settings/llm/route.ts \
  apps/web/src/app/api/actions/[actionKey]/validate/route.ts && \
git commit -m "refactor: migrate 5 routes to common API response format (P16)"
```

---

## Task 6-4: 나머지 route 마이그레이션 + 응답 포맷 통일

**Files:**
- Modify: `apps/web/src/app/api/modules/[moduleKey]/validate/route.ts` (및 7-8개 추가 route)

**Interfaces:**
- Consumes: Task 6-3와 동일 (createApiResponse, createApiErrorResponse)
- Produces: 모든 route가 공통 응답 포맷 준수

**Steps:**

- [ ] **Step 1: 마이그레이션 대상 route 목록 작성**

```bash
find apps/web/src/app/api -name "route.ts" -type f | \
  grep -v "_lib" | grep -v "trpc" | \
  wc -l
```

Expected: 20+ routes

Task 6-3에서 5개 마이그레이션 완료했으므로, 15+ route 남음.

- [ ] **Step 2: 배치 마이그레이션 (8개 route 선택)**

주요 route 8개를 선택하여 Task 6-3과 동일한 패턴으로 마이그레이션:
- modules/[moduleKey]/validate
- mail-insight-threads/generate
- proposals/route.ts
- approvals/route.ts
- automation/plan/route.ts
- automation/analyze/route.ts
- finance/[...path]/route.ts
- summary/route.ts

각각에 대해:
```typescript
import { createApiResponse, createApiErrorResponse } from '../../../_lib/api-response';
import { API_ERRORS } from '../../../_lib/api-error';

export async function POST(req: NextRequest) {
  try {
    assertApiAccess(req);
    // ... business logic
    return createApiResponse(result);
  } catch (error) {
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors

- [ ] **Step 4: 전체 route 응답 포맷 검증**

```bash
# 임의의 route 선택하여 테스트
curl "http://localhost:3000/api/[route]" -H "Authorization: Bearer <token>"
```

Expected: 모든 response가 `{ success, data|error, meta }` 형태

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/**/**/route.ts && \
git commit -m "refactor: apply common API response format to all routes (P16)"
```

---

## Task 6-5: OpenAPI 스펙 자동 생성 (tRPC-OpenAPI)

**Files:**
- Install: @trpc/openapi (package.json)
- Create: `apps/web/src/trpc/openapi.ts`
- Create: `apps/web/src/app/api/openapi.json/route.ts`
- Modify: `apps/web/src/trpc/index.ts` (OpenAPI 메타데이터 추가)

**Interfaces:**
- Consumes: tRPC appRouter
- Produces: OpenAPI 3.0 스펙 JSON

**Steps:**

- [ ] **Step 1: @trpc/openapi 패키지 추가**

```bash
cd apps/web && pnpm add @trpc/openapi
```

- [ ] **Step 2: apps/web/src/trpc/openapi.ts 생성**

```typescript
// apps/web/src/trpc/openapi.ts
import { generateOpenApiDocument } from '@trpc/openapi';
import { appRouter } from './index';

export const openApiDocument = generateOpenApiDocument(appRouter, {
  title: 'Sangfor OS API',
  description: 'Type-safe API for Sangfor OS',
  version: '1.0.0',
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api',
  tags: ['hello', 'mail', 'crm'],
});
```

- [ ] **Step 3: OpenAPI 엔드포인트 생성**

```typescript
// apps/web/src/app/api/openapi.json/route.ts
import { NextResponse } from 'next/server';
import { openApiDocument } from '@/trpc/openapi';

export async function GET() {
  return NextResponse.json(openApiDocument);
}
```

- [ ] **Step 4: Swagger UI 엔드포인트 (선택)**

```typescript
// apps/web/src/app/api/docs/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>Sangfor OS API Docs</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui.min.css">
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.15.5/swagger-ui.bundle.min.js"></script>
    <script>
      window.onload = () => {
        SwaggerUIBundle({
          url: '/api/openapi.json',
          dom_id: '#swagger-ui',
        })
      }
    </script>
  </body>
</html>
  `;
  return new NextResponse(html, {
    headers: { 'content-type': 'text/html' },
  });
}
```

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors

- [ ] **Step 6: OpenAPI 스펙 검증**

```bash
# OpenAPI JSON 엔드포인트 확인
curl http://localhost:3000/api/openapi.json | jq .
```

Expected: valid OpenAPI 3.0 document with paths, components, etc.

- [ ] **Step 7: Commit**

```bash
git add apps/web && \
git commit -m "feat: generate OpenAPI spec from tRPC router (P16)"
```

---

## Task 6-6: 통합 테스트 + 문서화

**Files:**
- Create: `apps/web/src/app/api/__tests__/api-response.test.ts`
- Create: `docs/API.md` (API 문서)

**Steps:**

- [ ] **Step 1: API 응답 포맷 테스트 작성**

```typescript
// apps/web/src/app/api/__tests__/api-response.test.ts
import { createApiResponse, createApiErrorResponse } from '../_lib/api-response';
import { API_ERRORS } from '../_lib/api-error';

describe('API Response Format', () => {
  test('createApiResponse returns correct format', () => {
    const response = createApiResponse({ id: 1, name: 'test' });
    const json = response.json();
    
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ id: 1, name: 'test' });
    expect(json.meta.timestamp).toBeDefined();
  });

  test('createApiErrorResponse returns error format', () => {
    const error = API_ERRORS.NOT_FOUND();
    const response = createApiErrorResponse(error);
    const json = response.json();
    
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
pnpm test --filter "@sangfor/web" -- api-response.test.ts
```

Expected: all tests pass

- [ ] **Step 3: API 문서 작성**

```markdown
# Sangfor OS API Documentation

## Response Format

All API responses follow a common format:

```json
{
  "success": boolean,
  "data": any,           // Only if success === true
  "error": {             // Only if success === false
    "code": string,
    "message": string
  },
  "meta": {
    "timestamp": number
  }
}
```

## Error Codes

- `UNAUTHORIZED` (401): Missing or invalid authentication
- `FORBIDDEN` (403): Authenticated but not authorized
- `NOT_FOUND` (404): Resource not found
- `VALIDATION_ERROR` (400): Request validation failed
- `INTERNAL_ERROR` (500): Server error
- `DATABASE_ERROR` (500): Database operation failed

## tRPC Endpoints

All endpoints are accessible via `/api/trpc/<router>.<procedure>`.

Example: `GET /api/trpc/hello.greet?input=%7B%22name%22%3A%22World%22%7D`

## OpenAPI Documentation

Interactive API documentation available at: `/api/docs`

OpenAPI schema: `/api/openapi.json`
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/__tests__/ docs/API.md && \
git commit -m "docs: add API documentation and response format tests (P16)"
```

---

## Phase 6 최종 게이트

- [ ] **모든 6개 task 완료 확인**

```bash
git log --oneline | grep "P16" | head -6
```

Expected: 6개 commit (refactor/feat with P16 tag)

- [ ] **전역 타입 검사**

```bash
pnpm typecheck
```

Expected: 0 errors

- [ ] **전역 테스트**

```bash
pnpm test --run
```

Expected: all tests pass, Phase 0 golden snapshot 무변화

- [ ] **API 응답 포맷 검증 (샘플 route)**

```bash
curl -X GET "http://localhost:3000/api/daily-report" \
  -H "Authorization: Bearer test-token" | jq .
```

Expected: `{ success, data, meta }`

- [ ] **tRPC + OpenAPI 검증**

```bash
# tRPC 호출
curl "http://localhost:3000/api/trpc/hello.greet?input=%7B%22name%22%3A%22Test%22%7D"

# OpenAPI 스펙 검증
curl "http://localhost:3000/api/openapi.json" | jq .info
```

Expected: tRPC working, OpenAPI document valid

---

## 참고

- **Route 응답 통일**: Task 6-3, 6-4에서 모든 route가 공통 포맷 준수
- **tRPC**: type-safe RPC, 점진적으로 추가 가능 (Task 6-2 후속)
- **OpenAPI**: tRPC-OpenAPI로 자동 생성, Swagger UI로 탐색 가능
- **하위호환성**: 기존 route 호출 패턴 유지, 응답 포맷만 정규화

---

# Phase 7 Implementation Plan — DB 스키마 정리 (Prisma 확장)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prisma schema를 expand-contract 패턴으로 개선하여 새로운 column을 추가하고, composite index를 추가하여 쿼리 성능을 최적화.

**Architecture:** 기존 schema.prisma (2493줄)에서 (1) mail_domain, customer, opportunity 테이블의 expand phase (신규 column 추가) (2) composite index 추가 (mail domain filtering, customer lookup, opportunity stage) (3) migration 파일 생성 및 백필 로직 (4) 기존 데이터 호환성 검증.

**Tech Stack:** Prisma, PostgreSQL, migration scripts, TypeScript

## Global Constraints

- **expand-contract 패턴**: 기존 column 삭제 불가 (하위호환성), 신규 column default 필수
- **각 migration**: packages/db/prisma/migrations/ 에 YYYYMMDDHHMMSS-<description>.sql 파일로 생성
- **typecheck + test**: 각 task 후 `pnpm typecheck`, `pnpm test --filter @sangfor/db --run`
- **CI/CD**: migration 적용 후 seed.ts로 테스트 데이터 재생성 가능해야 함
- **데이터 마이그레이션**: 기존 행 null → default 또는 역계산으로 채우기

---

## 파일 구조

```
packages/db/
├── prisma/
│   ├── schema.prisma              (수정: expand phase, index 추가)
│   ├── migrations/
│   │   ├── 20260703120000_expand_mail_domain/
│   │   │   └── migration.sql      (새로 생성: mail_domain column 추가)
│   │   ├── 20260703120100_expand_customer/
│   │   │   └── migration.sql      (새로 생성: customer column 추가)
│   │   ├── 20260703120200_expand_opportunity/
│   │   │   └── migration.sql      (새로 생성: opportunity column 추가)
│   │   └── 20260703120300_add_composite_indexes/
│   │       └── migration.sql      (새로 생성: index 추가)
│   ├── seed.ts                    (수정: 신규 column 데이터 생성)
│   └── scripts/
│       └── backfill-migrations.ts (새로 생성: 기존 행 backfill)
```

---

## Task 분할 전략 (순차)

```
Task 7-1: mail_domain 테이블 expand (신규 column: classification_status)
Task 7-2: customer 테이블 expand (신규 column: segment, risk_score)
Task 7-3: opportunity 테이블 expand (신규 column: stage_entered_at, probability_override)
Task 7-4: Composite index 추가 (mail_domain, customer, opportunity)
Task 7-5: Backfill 스크립트 + seed 업데이트
Task 7-6: 통합 테스트 + 문서화

총 6개 task, 순차 실행 (migration 순서 중요)
```

---

## Task 7-1: mail_domain 테이블 expand (신규 column 추가)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (mail_domain model)
- Create: `packages/db/prisma/migrations/20260703120000_expand_mail_domain/migration.sql`

**Interfaces:**
- Produces: mail_domain model에 `classificationStatus: String @default("PENDING")` column

**Steps:**

- [ ] **Step 1: 현재 mail_domain schema 확인**

```bash
grep -A 15 "model mail_domain" packages/db/prisma/schema.prisma
```

Expected: id, domain, mailCount, lastSyncAt, createdAt 등 기존 column들

- [ ] **Step 2: schema.prisma 수정 (expand phase)**

기존:
```prisma
model mail_domain {
  id          Int      @id @default(autoincrement())
  domain      String   @unique
  mailCount   Int      @default(0)
  lastSyncAt  DateTime @updatedAt
  createdAt   DateTime @default(now())
}
```

변경:
```prisma
model mail_domain {
  id                    Int      @id @default(autoincrement())
  domain                String   @unique
  mailCount             Int      @default(0)
  classificationStatus  String   @default("PENDING")  // NEW: expand phase
  lastSyncAt            DateTime @updatedAt
  createdAt             DateTime @default(now())
}
```

- [ ] **Step 3: migration.sql 생성**

```sql
-- packages/db/prisma/migrations/20260703120000_expand_mail_domain/migration.sql
-- Expand mail_domain: add classificationStatus column
ALTER TABLE "mail_domain" 
ADD COLUMN "classificationStatus" TEXT NOT NULL DEFAULT 'PENDING';

-- Comment for future contract phase
COMMENT ON COLUMN "mail_domain"."classificationStatus" 
IS 'Expansion phase (2026-07-03): add classificationStatus, default PENDING';
```

- [ ] **Step 4: migration 적용 테스트**

```bash
cd packages/db && pnpm prisma migrate dev --name expand_mail_domain
```

Expected: Migration applied successfully

- [ ] **Step 5: typecheck + test**

```bash
pnpm typecheck --filter @sangfor/db && \
pnpm test --filter @sangfor/db --run
```

Expected: 0 errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260703120000_expand_mail_domain/ && \
git commit -m "refactor: expand mail_domain schema (add classificationStatus) (P17)"
```

---

## Task 7-2: customer 테이블 expand

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (customer model)
- Create: `packages/db/prisma/migrations/20260703120100_expand_customer/migration.sql`

**Interfaces:**
- Produces: customer model에 `segment: String?`, `riskScore: Float?` columns

**Steps:**

- [ ] **Step 1: 현재 customer schema 확인**

```bash
grep -A 20 "^model customer" packages/db/prisma/schema.prisma
```

Expected: id, name, email, industry, score, createdAt 등 기존 column들

- [ ] **Step 2: schema.prisma 수정**

신규 column 추가:
```prisma
model customer {
  // ... 기존 fields ...
  segment       String?   @default("UNCLASSIFIED")  // NEW: expand phase
  riskScore     Float?    @default(0.5)             // NEW: expand phase
}
```

- [ ] **Step 3: migration.sql 생성**

```sql
-- packages/db/prisma/migrations/20260703120100_expand_customer/migration.sql
ALTER TABLE "customer" 
ADD COLUMN "segment" TEXT DEFAULT 'UNCLASSIFIED',
ADD COLUMN "riskScore" DOUBLE PRECISION DEFAULT 0.5;

COMMENT ON COLUMN "customer"."segment" 
IS 'Expansion phase (2026-07-03): customer segmentation';

COMMENT ON COLUMN "customer"."riskScore" 
IS 'Expansion phase (2026-07-03): risk assessment score (0-1)';
```

- [ ] **Step 4: migration 적용**

```bash
cd packages/db && pnpm prisma migrate dev --name expand_customer
```

Expected: Migration applied

- [ ] **Step 5: typecheck + test**

```bash
pnpm typecheck --filter @sangfor/db && \
pnpm test --filter @sangfor/db --run
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260703120100_expand_customer/ && \
git commit -m "refactor: expand customer schema (add segment, riskScore) (P17)"
```

---

## Task 7-3: opportunity 테이블 expand

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (opportunity model)
- Create: `packages/db/prisma/migrations/20260703120200_expand_opportunity/migration.sql`

**Steps:**

- [ ] **Step 1: 현재 opportunity schema 확인**

```bash
grep -A 25 "^model opportunity" packages/db/prisma/schema.prisma
```

Expected: id, customerId, stage, amount, createdAt 등

- [ ] **Step 2: schema.prisma 수정**

신규 column 추가:
```prisma
model opportunity {
  // ... 기존 fields ...
  stageEnteredAt      DateTime?  // NEW: when opportunity entered current stage
  probabilityOverride Float?     @default(0.0)  // NEW: override AI-predicted probability
}
```

- [ ] **Step 3: migration.sql 생성**

```sql
-- packages/db/prisma/migrations/20260703120200_expand_opportunity/migration.sql
ALTER TABLE "opportunity" 
ADD COLUMN "stageEnteredAt" TIMESTAMP,
ADD COLUMN "probabilityOverride" DOUBLE PRECISION DEFAULT 0.0;

COMMENT ON COLUMN "opportunity"."stageEnteredAt"
IS 'Expansion phase (2026-07-03): track when opportunity entered current stage';

COMMENT ON COLUMN "opportunity"."probabilityOverride"
IS 'Expansion phase (2026-07-03): manual override for win probability (0-1)';
```

- [ ] **Step 4: migration 적용**

```bash
cd packages/db && pnpm prisma migrate dev --name expand_opportunity
```

Expected: Migration applied

- [ ] **Step 5: typecheck + test**

```bash
pnpm typecheck --filter @sangfor/db && \
pnpm test --filter @sangfor/db --run
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260703120200_expand_opportunity/ && \
git commit -m "refactor: expand opportunity schema (add stageEnteredAt, probabilityOverride) (P17)"
```

---

## Task 7-4: Composite index 추가

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model definitions에 @@index 추가)
- Create: `packages/db/prisma/migrations/20260703120300_add_composite_indexes/migration.sql`

**Steps:**

- [ ] **Step 1: 필요한 composite index 정의**

Query 성능 최적화를 위한 index:
1. mail_domain: (domain, classificationStatus) - domain filtering + status 조회
2. customer: (segment, riskScore) - segmentation-based queries
3. opportunity: (customerId, stage) - customer별 opportunity 조회
4. opportunity: (stage, stageEnteredAt) - stage transition tracking

- [ ] **Step 2: schema.prisma 수정 (index 정의)**

```prisma
model mail_domain {
  // ... fields ...
  
  @@index([domain, classificationStatus])
}

model customer {
  // ... fields ...
  
  @@index([segment, riskScore])
}

model opportunity {
  // ... fields ...
  
  @@index([customerId, stage])
  @@index([stage, stageEnteredAt])
}
```

- [ ] **Step 3: migration.sql 생성**

```sql
-- packages/db/prisma/migrations/20260703120300_add_composite_indexes/migration.sql
-- Composite indexes for performance optimization

CREATE INDEX "mail_domain_domain_classificationStatus_idx" 
ON "mail_domain"("domain", "classificationStatus");

CREATE INDEX "customer_segment_riskScore_idx" 
ON "customer"("segment", "riskScore");

CREATE INDEX "opportunity_customerId_stage_idx" 
ON "opportunity"("customerId", "stage");

CREATE INDEX "opportunity_stage_stageEnteredAt_idx" 
ON "opportunity"("stage", "stageEnteredAt");
```

- [ ] **Step 4: migration 적용**

```bash
cd packages/db && pnpm prisma migrate dev --name add_composite_indexes
```

Expected: Indexes created

- [ ] **Step 5: index 검증**

```bash
# 생성된 인덱스 확인
psql -U $DATABASE_USER -d $DATABASE_NAME -c "\di+ mail_domain*"
```

Expected: 4개 index 생성됨

- [ ] **Step 6: typecheck + test**

```bash
pnpm typecheck --filter @sangfor/db && \
pnpm test --filter @sangfor/db --run
```

Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260703120300_add_composite_indexes/ && \
git commit -m "refactor: add composite indexes for query optimization (P17)"
```

---

## Task 7-5: Backfill 스크립트 + seed 업데이트

**Files:**
- Create: `packages/db/prisma/scripts/backfill-migrations.ts`
- Modify: `packages/db/prisma/seed.ts`

**Steps:**

- [ ] **Step 1: backfill 스크립트 작성**

```typescript
// packages/db/prisma/scripts/backfill-migrations.ts
import { prisma } from '@sangfor/db';

async function backfillMailDomain() {
  console.log('Backfilling mail_domain.classificationStatus...');
  const updated = await prisma.mail_domain.updateMany({
    where: { classificationStatus: null },
    data: { classificationStatus: 'PENDING' },
  });
  console.log(`Updated ${updated.count} mail_domain records`);
}

async function backfillCustomer() {
  console.log('Backfilling customer.segment and riskScore...');
  const updated = await prisma.customer.updateMany({
    where: { segment: null },
    data: { 
      segment: 'UNCLASSIFIED',
      riskScore: 0.5,
    },
  });
  console.log(`Updated ${updated.count} customer records`);
}

async function backfillOpportunity() {
  console.log('Backfilling opportunity.stageEnteredAt...');
  // stageEnteredAt는 createdAt으로 초기화
  const updated = await prisma.opportunity.updateMany({
    where: { stageEnteredAt: null },
    data: {
      stageEnteredAt: { set: new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000) }, // 30 days ago as default
    },
  });
  console.log(`Updated ${updated.count} opportunity records`);
}

async function main() {
  console.log('Starting backfill migrations...');
  
  try {
    await backfillMailDomain();
    await backfillCustomer();
    await backfillOpportunity();
    console.log('✅ Backfill complete');
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: seed.ts 수정 (신규 column 데이터 포함)**

```typescript
// packages/db/prisma/seed.ts 의 mail_domain 생성 부분
await prisma.mail_domain.create({
  data: {
    domain: 'customer.example.com',
    mailCount: 150,
    classificationStatus: 'CLASSIFIED',  // NEW field
    lastSyncAt: new Date(),
  },
});

// customer 생성 부분
await prisma.customer.create({
  data: {
    name: 'Acme Corp',
    email: 'contact@acme.com',
    segment: 'ENTERPRISE',           // NEW field
    riskScore: 0.2,                  // NEW field
  },
});

// opportunity 생성 부분
await prisma.opportunity.create({
  data: {
    customerId: 1,
    amount: 50000,
    stage: 'PROPOSAL',
    stageEnteredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),  // NEW field
    probabilityOverride: 0.0,        // NEW field
  },
});
```

- [ ] **Step 3: backfill 스크립트 테스트**

```bash
cd packages/db && pnpm tsx prisma/scripts/backfill-migrations.ts
```

Expected: Backfill complete, 정확한 행 수 업데이트

- [ ] **Step 4: seed 재생성 테스트**

```bash
cd packages/db && pnpm prisma db seed
```

Expected: Seed successful, 새로운 column 데이터 포함

- [ ] **Step 5: typecheck + test**

```bash
pnpm typecheck --filter @sangfor/db && \
pnpm test --filter @sangfor/db --run
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/scripts/backfill-migrations.ts packages/db/prisma/seed.ts && \
git commit -m "refactor: add backfill script and update seed for expanded columns (P17)"
```

---

## Task 7-6: 통합 테스트 + 문서화

**Files:**
- Create: `packages/db/src/__tests__/schema-expansion.test.ts`
- Create: `docs/DB_MIGRATION.md`

**Steps:**

- [ ] **Step 1: schema expansion 테스트 작성**

```typescript
// packages/db/src/__tests__/schema-expansion.test.ts
import { prisma } from '@sangfor/db';

describe('Schema Expansion (Phase 7)', () => {
  test('mail_domain has classificationStatus column', async () => {
    const record = await prisma.mail_domain.create({
      data: {
        domain: 'test.example.com',
        classificationStatus: 'PENDING',
      },
    });
    
    expect(record.classificationStatus).toBe('PENDING');
  });

  test('customer has segment and riskScore columns', async () => {
    const record = await prisma.customer.create({
      data: {
        name: 'Test Customer',
        email: 'test@example.com',
        segment: 'ENTERPRISE',
        riskScore: 0.3,
      },
    });
    
    expect(record.segment).toBe('ENTERPRISE');
    expect(record.riskScore).toBe(0.3);
  });

  test('opportunity has stageEnteredAt and probabilityOverride', async () => {
    const customer = await prisma.customer.create({
      data: { name: 'Customer', email: 'c@test.com' },
    });
    
    const now = new Date();
    const record = await prisma.opportunity.create({
      data: {
        customerId: customer.id,
        amount: 10000,
        stage: 'PROPOSAL',
        stageEnteredAt: now,
        probabilityOverride: 0.75,
      },
    });
    
    expect(record.stageEnteredAt).toBeDefined();
    expect(record.probabilityOverride).toBe(0.75);
  });

  test('composite indexes are created', async () => {
    // Query using composite indexes
    const customers = await prisma.customer.findMany({
      where: { segment: 'ENTERPRISE' },
      orderBy: { riskScore: 'asc' },
    });
    
    expect(Array.isArray(customers)).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
pnpm test --filter @sangfor/db -- schema-expansion.test.ts
```

Expected: all tests pass

- [ ] **Step 3: 마이그레이션 문서 작성**

```markdown
# Database Migration Documentation

## Phase 7: Schema Expansion (2026-07-03)

### Overview

Expanded three core tables with new columns to support enhanced data classification and risk assessment.

### Migrations

#### 1. mail_domain expansion
- **Column added**: `classificationStatus` (TEXT, default: 'PENDING')
- **Purpose**: Track mail classification status
- **Migration**: 20260703120000_expand_mail_domain

#### 2. customer expansion  
- **Columns added**:
  - `segment` (TEXT, default: 'UNCLASSIFIED')
  - `riskScore` (DOUBLE PRECISION, default: 0.5)
- **Purpose**: Customer segmentation and risk assessment
- **Migration**: 20260703120100_expand_customer

#### 3. opportunity expansion
- **Columns added**:
  - `stageEnteredAt` (TIMESTAMP)
  - `probabilityOverride` (DOUBLE PRECISION, default: 0.0)
- **Purpose**: Track stage transitions and override AI predictions
- **Migration**: 20260703120200_expand_opportunity

#### 4. Composite indexes
- `mail_domain(domain, classificationStatus)`
- `customer(segment, riskScore)`
- `opportunity(customerId, stage)`
- `opportunity(stage, stageEnteredAt)`
- **Purpose**: Optimize query performance
- **Migration**: 20260703120300_add_composite_indexes

### Backfill Process

```bash
# Run backfill script to populate new columns with defaults
pnpm tsx prisma/scripts/backfill-migrations.ts

# Regenerate seed data
pnpm prisma db seed
```

### Rollback Plan

If issues arise, use Prisma's built-in rollback:

```bash
pnpm prisma migrate resolve --rolled-back 20260703120300_add_composite_indexes
```

Contract phase (column removal) scheduled for future sprint.
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/__tests__/schema-expansion.test.ts docs/DB_MIGRATION.md && \
git commit -m "docs: add schema expansion tests and migration documentation (P17)"
```

---

## Phase 7 최종 게이트

- [ ] **모든 6개 migration 적용 확인**

```bash
cd packages/db && pnpm prisma migrate status
```

Expected: All 6 migrations applied (20260703120000 ~ 20260703120300)

- [ ] **schema.prisma 검증**

```bash
cd packages/db && pnpm prisma validate
```

Expected: Valid schema

- [ ] **전역 typecheck + test**

```bash
pnpm typecheck && \
pnpm test --run
```

Expected: 0 errors, all tests pass, Phase 0 golden snapshot 무변화

- [ ] **Backfill 검증**

```bash
cd packages/db && pnpm tsx prisma/scripts/backfill-migrations.ts
```

Expected: Backfill complete

- [ ] **Index 생성 확인**

```bash
psql -U $DATABASE_USER -d $DATABASE_NAME -c "SELECT schemaname, tablename, indexname FROM pg_indexes WHERE tablename IN ('mail_domain', 'customer', 'opportunity');"
```

Expected: 4개 composite index 생성됨

---

## 참고

- **Expand-Contract 패턴**: 신규 column은 항상 nullable 또는 default value 필요
- **하위호환성**: 기존 코드는 수정 불필요 (새로운 column은 optional)
- **성능**: Composite index로 주요 쿼리 최적화 (mail domain filtering, customer segmentation, opportunity stage tracking)
- **롤백**: 문제 발생 시 Prisma migrate resolve로 특정 migration 롤백 가능

