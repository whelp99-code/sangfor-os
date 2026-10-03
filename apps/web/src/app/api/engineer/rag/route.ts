import { engineerConsole } from "@sangfor/infra";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

/** POST /api/engineer/rag — RAG search via engineer console. Body: { query, product?, version?, limit? } */
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/engineer/rag/route.ts");
  if (capabilityDenied) return capabilityDenied;
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return Response.json({ error: "body must be an object" }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return Response.json({ error: "query is required" }, { status: 400 });
  if (typeof body.query !== "string" || body.query.length > 8_000) {
    return Response.json({ error: "query must be at most 8000 characters" }, { status: 400 });
  }

  for (const field of ["product", "version"] as const) {
    const value = body[field];
    if (value !== undefined && (typeof value !== "string" || !value.trim() || value.length > 100)) {
      return Response.json({ error: `${field} must be a non-empty string of at most 100 characters` }, { status: 400 });
    }
  }
  if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 20)) {
    return Response.json({ error: "limit must be an integer between 1 and 20" }, { status: 400 });
  }

  try {
    const result = await engineerConsole.ragSearch({
      query,
      product: typeof body.product === "string" ? body.product.trim() : undefined,
      version: typeof body.version === "string" ? body.version.trim() : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
    });
    return Response.json(result);
  } catch (error) {
    return apiError("rag_search_failed", error, {
      status: 502,
      extra: { results: [] },
    });
  }
}
