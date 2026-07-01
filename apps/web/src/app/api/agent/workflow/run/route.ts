import { runConfigAutomation } from "@sangfor/agent";

import { workflowRunStore } from "@/lib/agent/workflow-run-store";
import { assertApiAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent/workflow/run — run the cross-service config-automation
 * workflow, streaming each stage as SSE.
 * Body: { requirements: string, approvals?: string[] }
 * Events: `run`, `stage` (each StageResult), `done`, `error`.
 */
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  let body: { requirements?: unknown; approvals?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const requirements = typeof body.requirements === "string" ? body.requirements.trim() : "";
  if (!requirements) return Response.json({ error: "requirements is required" }, { status: 400 });
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

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
