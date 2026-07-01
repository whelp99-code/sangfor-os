import { engineerConsole } from "@sangfor/infra";

export const dynamic = "force-dynamic";

/** GET /api/engineer/knowledge?product=HCI&type=manual — manuals/wiki sections. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const product = url.searchParams.get("product") || "HCI";
  const type = url.searchParams.get("type") || "manual";
  try {
    return Response.json(await engineerConsole.knowledge(product, type));
  } catch (error) {
    // Sanitize: log server-side, return a stable code (no raw error.message).
    console.error("[api] knowledge_failed:", error);
    return Response.json({ items: [], error: "knowledge_failed" }, { status: 502 });
  }
}
