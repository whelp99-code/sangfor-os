import { engineerConsole } from "@sangfor/infra";

export const dynamic = "force-dynamic";

const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT"]);

/** The engineer console is an optional upstream; when it is not deployed every call fails with a
 * connection error nested under fetch's AggregateError. That is a known degradation, so it is
 * logged as one line — printing the stack for it trains operators to skim past real failures. */
export function isUpstreamUnreachable(error: unknown, seen = new Set<unknown>()): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  const { code, cause, errors } = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof code === "string" && UNREACHABLE_CODES.has(code)) return true;
  if (Array.isArray(errors) && errors.some((nested) => isUpstreamUnreachable(nested, seen))) return true;
  return isUpstreamUnreachable(cause, seen);
}

/** GET /api/engineer/products — product catalog from the engineer console. */
export async function GET() {
  try {
    return Response.json(await engineerConsole.products());
  } catch (error) {
    if (isUpstreamUnreachable(error)) console.warn("[api] products_unavailable: engineer console unreachable");
    else console.warn("[api] products_unavailable:", error);
    return Response.json({ products: [], error: "products_unavailable", degraded: true });
  }
}
