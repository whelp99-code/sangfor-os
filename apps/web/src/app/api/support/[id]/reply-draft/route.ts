import { withRlsTransaction } from "@sangfor/db";
import { engineerConsole } from "@sangfor/infra";
import {
  buildSupportReplyDraft,
  supportReplyRequestSchema,
  unavailableSupportReplyDraft,
} from "@sangfor/business";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { resolveBusinessCapabilityContext } from "@/lib/auth/authorization";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

/** Read-only preview. Does not call domain-stage approval/learning, mail, or device tools. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const session = await evaluatePersistedSessionFromRequest(request);
  if (!session.ok) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  let context;
  try {
    const resolved = await resolveBusinessCapabilityContext({
      userId: session.userId, sessionId: null, tenantId: session.tenantId,
      companyId: session.companyId, projectId: session.projectId, product: "portal",
    }, "apps/web/src/app/api/support/[id]/reply-draft/route.ts");
    if (!resolved.ok) return resolved.response;
    context = resolved.context;
  } catch {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE }); }
  const parsed = supportReplyRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "validation_error" }, { status: 422, headers: NO_STORE });
  const { id } = await params;
  try {
    const supportCase = await withRlsTransaction(context, (tx) => tx.supportCase.findFirst({
      where: { id, customer: { projectId: context.projectId, archivedAt: null } },
      select: { id: true, revision: true },
    }));
    if (!supportCase) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    const input = parsed.data;
    // Commercial conditions need an explicitly approved private source, not a
    // public manual. Return a useful clarification draft without transmitting data.
    if (input.topic === "renewal" || input.topic === "service_letter" || (input.topic === "kernel_patch" && !input.version)) {
      return Response.json({ ...buildSupportReplyDraft(input, { results: [] }), caseRevision: supportCase.revision }, { headers: NO_STORE });
    }
    try {
      const search = await engineerConsole.ragSearch({
        query: input.query, product: input.product, version: input.version, limit: 5,
      });
      return Response.json({ ...buildSupportReplyDraft(input, search), caseRevision: supportCase.revision }, { headers: NO_STORE });
    } catch {
      return Response.json({ ...unavailableSupportReplyDraft(), caseRevision: supportCase.revision }, { status: 502, headers: NO_STORE });
    }
  } catch (error) {
    return apiError("support_reply_preview_failed", error, { status: 500 });
  }
}
