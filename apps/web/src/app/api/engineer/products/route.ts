import { engineerConsole } from "@sangfor/infra";

import { isUpstreamUnreachable } from "@/lib/upstream-error";

export const dynamic = "force-dynamic";

/** GET /api/engineer/products — product catalog from the engineer console. The console is an
 * optional upstream; when it is not deployed the call fails on connect. That degradation is
 * expected, so it is logged as one line — a stack for normal behaviour trains operators to skim. */
export async function GET() {
  try {
    return Response.json(await engineerConsole.products());
  } catch (error) {
    if (isUpstreamUnreachable(error)) console.warn("[api] products_unavailable: engineer console unreachable");
    else console.warn("[api] products_unavailable:", error);
    return Response.json({ products: [], error: "products_unavailable", degraded: true });
  }
}
