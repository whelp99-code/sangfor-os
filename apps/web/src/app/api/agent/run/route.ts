import { runMcpAgent } from "@sangfor/agent";

import { agentRunStore } from "@/lib/agent/run-store";
import type { RunSource } from "@/lib/agent/types";
import { assertApiAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent/run — run the MCP agent, streaming each step as SSE.
 * Body: { goal: string, maxSteps?: number, allowUnsafe?: boolean, source?, playbookId? }
 * Events: `run` (start), `step` (each AgentStep), `done` (terminal), `error`.
 */
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;

  let body: {
    goal?: unknown;
    maxSteps?: unknown;
    allowUnsafe?: unknown;
    source?: unknown;
    playbookId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) return Response.json({ error: "goal is required" }, { status: 400 });

  const maxSteps = typeof body.maxSteps === "number" ? body.maxSteps : undefined;
  const allowUnsafe = body.allowUnsafe === true;
  const source = (typeof body.source === "string" ? body.source : "manual") as RunSource;
  const playbookId = typeof body.playbookId === "string" ? body.playbookId : undefined;

  const record = agentRunStore.create({ goal, allowUnsafe, maxSteps, source, playbookId });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("run", { id: record.id, goal, createdAt: record.createdAt });

      try {
        const result = await runMcpAgent({
          goal,
          maxSteps,
          allowUnsafe,
          onStep: (step) => {
            agentRunStore.appendStep(record.id, step);
            send("step", step);
          },
        });
        agentRunStore.finish(record.id, result);
        send("done", {
          id: record.id,
          status: result.status,
          answer: result.answer,
          blockedTool: result.blockedTool,
          blockedArguments: result.blockedArguments,
        });
      } catch (error) {
        // Sanitize: log the real cause server-side, surface only a stable code
        // (raw error.message can leak internal/upstream detail to the browser).
        console.error("[api] agent_run_failed:", error instanceof Error ? error.stack ?? error.message : error);
        const message = "agent_run_failed";
        agentRunStore.finish(record.id, { status: "error", error: message });
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
