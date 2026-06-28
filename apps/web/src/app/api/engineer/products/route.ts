import { engineerConsole } from "@sangfor/infra";

export const dynamic = "force-dynamic";

/** GET /api/engineer/products — product catalog from the engineer console. */
export async function GET() {
  try {
    return Response.json(await engineerConsole.products());
  } catch (error) {
    return Response.json(
      { products: [], error: error instanceof Error ? error.message : "products_failed" },
      { status: 502 },
    );
  }
}
