import { engineerConsole } from "@sangfor/infra";

export const dynamic = "force-dynamic";

/** GET /api/engineer/products — product catalog from the engineer console. */
export async function GET() {
  try {
    return Response.json(await engineerConsole.products());
  } catch (error) {
    // Sanitize: log server-side, return a stable code (no raw error.message).
    console.error("[api] products_failed:", error);
    return Response.json({ products: [], error: "products_failed" }, { status: 502 });
  }
}
