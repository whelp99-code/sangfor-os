import { engineerConsole } from "@sangfor/infra";

export const dynamic = "force-dynamic";

/** POST /api/engineer/rag — RAG search via engineer console. Body: { query, product?, limit? } */
export async function POST(request: Request) {
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
    return Response.json(
      { results: [], error: error instanceof Error ? error.message : "rag_search_failed" },
      { status: 502 },
    );
  }
}
