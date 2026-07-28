import { runConfigAutomation } from "@sangfor/agent";

import { workflowRunStore } from "@/lib/agent/workflow-run-store";
import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

/**
 * @deprecated POST /api/agent/workflow/run — legacy command-simulation compatibility endpoint.
 * It never activates a U019 definition, supplies an approval, or creates canonical persisted
 * authority. Canonical callers use /api/workflow-definitions and /api/workflow-runs.
 *
 * The simulated cross-service config-automation stages remain available only for legacy UI
 * characterization; U025 does not add a tool/external execution path here.
 * Body: { requirements: string, approvals?: string[] }
 * Events: `run`, `stage` (each StageResult), `done`, `error`.
 */
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/agent/workflow/run/route.ts");
  if (capabilityDenied) return capabilityDenied;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return legacyResponse(Response.json({ error: "request body must be an object" }, { status: 400 }));
    body = parsed as Record<string, unknown>;
  } catch {
    return legacyResponse(Response.json({ error: "invalid JSON body" }, { status: 400 }));
  }

  // A compatibility simulation must never become a back door to canonical authority. Reject the
  // complete canonical shape (and any actor/scope/status injection) rather than silently routing
  // it through a transient Map.
  for (const key of Object.keys(body)) {
    if (key === "requirements" || key === "approvals") continue;
    return legacyResponse(Response.json({ error: "canonical_workflow_authority_not_available_on_legacy_route" }, { status: 410 }));
  }

  const requirements = typeof body.requirements === "string" ? body.requirements.trim() : "";
  if (!requirements) return legacyResponse(Response.json({ error: "requirements is required" }, { status: 400 }));
  const approvals = Array.isArray(body.approvals)
    ? body.approvals.filter((a): a is string => typeof a === "string")
    : [];

  const record = workflowRunStore.create({ requirements, approvals });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("run", { id: record.id, requirements, createdAt: record.createdAt });

      try {
        const result = await runConfigAutomation({
          requirements,
          approvals,
          onStage: (stage) => {
            workflowRunStore.appendStage(record.id, stage);
            send("stage", stage);
          },
        });
        workflowRunStore.finish(record.id, result);
        send("done", {
          id: record.id,
          status: result.status,
          awaitingApproval: result.awaitingApproval,
        });
      } catch (error) {
        // Sanitize: log the real cause server-side, surface only a stable code
        // (raw error.message can leak internal/upstream detail to the browser).
        console.error("[api] workflow_run_failed:", error instanceof Error ? error.stack ?? error.message : error);
        const message = "workflow_run_failed";
        workflowRunStore.finish(record.id, { status: "error", error: message });
        send("error", { id: record.id, message });
      } finally {
        controller.close();
      }
    },
  });

  return legacyResponse(new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  }));
}

function legacyResponse(response: Response): Response {
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", '</api/workflow-runs>; rel="successor-version"');
  response.headers.set("X-Workflow-Authority", "legacy-simulation");
  return response;
}
