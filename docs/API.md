# Sangfor OS API

## Response Format

All API responses (except where noted) follow a standard envelope:

```json
{
  "success": true,
  "data": { "id": 1, "name": "test" },
  "meta": { "timestamp": 1719000000000 }
}
```

Error responses replace `data` with an `error` object:

```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Not found" },
  "meta": { "timestamp": 1719000000000 }
}
```

The envelope is typed as `ApiResponse<T>` from `@sangfor/shared/types/api`.

## Error Codes

| Code | HTTP Status | Default Message | Factory Signature |
|------|-------------|-----------------|-------------------|
| `UNAUTHORIZED` | 401 | Unauthorized | `API_ERRORS.UNAUTHORIZED()` |
| `FORBIDDEN` | 403 | Forbidden | `API_ERRORS.FORBIDDEN()` |
| `NOT_FOUND` | 404 | Not found | `API_ERRORS.NOT_FOUND()` |
| `VALIDATION_ERROR` | 400 | *(message required)* | `API_ERRORS.VALIDATION_ERROR(msg: string)` |
| `INTERNAL_ERROR` | 500 | Internal server error | `API_ERRORS.INTERNAL_ERROR()` |
| `DATABASE_ERROR` | 500 | Database error | `API_ERRORS.DATABASE_ERROR(msg?: string)` |

Plain `Error` instances that are not `ApiError` are caught as `UNKNOWN_ERROR` (500).

## Migrated Routes

The following API routes use `createApiResponse` / `createApiErrorResponse` from `apps/web/src/app/api/_lib/api-response.ts`:

1. `daily-report/route.ts`
2. `domain-pipeline/route.ts`
3. `policy-memories/[id]/route.ts`
4. `settings/llm/route.ts`
5. `actions/[actionKey]/validate/route.ts`
6. `approvals/route.ts`
7. `automation/analyze/route.ts`
8. `automation/plan/route.ts`
9. `mail-insight-threads/generate/route.ts`
10. `modules/[moduleKey]/validate/route.ts`
11. `proposals/route.ts`
12. `summary/route.ts`
13. `finance/[...path]/route.ts`

> **Note**: `finance/[...path]/route.ts` uses the common envelope **only on its error path**. The success path is a raw proxy passthrough to an upstream finance service and does **not** wrap responses in the envelope.

## tRPC

tRPC procedures are available under `/api/trpc/<router>.<procedure>`. For example:

- **Procedure**: `hello.greet`
- **Input**: `{ "name": "Alice" }`
- **Output**: `{ "message": "Hello, Alice!" }`

The `hello` router is registered in `apps/web/src/trpc/index.ts` under the root `appRouter`, with additional routers added incrementally.

## OpenAPI

An OpenAPI 3.x specification is auto-generated from the tRPC router:

- **Spec**: `/api/openapi.json` — serves the generated document as JSON.
- **Docs UI**: `/api/docs` — serves a Swagger UI (v4.15.5) that reads from `/api/openapi.json`.

The spec is generated via `trpc-to-openapi` v2.4. Version 3.x of that package requires zod v4, while this repo is on zod v3, so v2.4 is used for compatibility.
