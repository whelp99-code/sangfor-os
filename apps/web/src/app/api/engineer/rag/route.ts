import { engineerConsole } from "@sangfor/infra";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** POST /api/engineer/rag — RAG search via engineer console. Body: { query, product?, limit? } */
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  let body: { query?: unknown; product?: unknown; limit?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return Response.json({ error: "query is required" }, { status: 400 });

  try {
    const result = await engineerConsole.ragSearch({
      query,
      product: typeof body.product === "string" ? body.product : undefined,
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
