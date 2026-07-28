import { engineerConsole } from "@sangfor/infra";

export const dynamic = "force-dynamic";

/** GET /api/engineer/products — product catalog from the engineer console. */
export async function GET() {
  try {
    return Response.json(await engineerConsole.products());
  } catch (error) {
    console.warn("[api] products_unavailable:", error);
    return Response.json({ products: [], error: "products_unavailable", degraded: true });
  }
}
