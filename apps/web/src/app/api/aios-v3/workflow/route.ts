import { NextResponse } from "next/server";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import {
  executeWorkflow,
  getWorkflowStatus,
  type WorkflowExecutionRequest,
} from "@/lib/aios-v3-bridge";

/**
 * Purpose:
 * - Proxy workflow execution requests from AIOS v1 to the F-aios-v3-core
 *   server running on localhost:3501.
 *
 * Failure Points:
 * - v3 server unreachable → 502 Bad Gateway with connection hint.
 * - Invalid request payload → 400 Bad Request.
 * - Workflow execution error → 500 with upstream error message.
 *
 * Observability:
 * - POST /api/aios-v3/workflow – execute a workflow
 * - GET  /api/aios-v3/workflow?runId=<id> – poll workflow status
 */

/** GET /api/aios-v3/workflow?runId=... – retrieve workflow run status */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");

  if (!runId) {
    return NextResponse.json(
      { error: "Missing required query parameter: runId" },
      { status: 400 },
    );
  }

  try {
    const result = await getWorkflowStatus(runId);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "workflow_status_fetch_failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** POST /api/aios-v3/workflow – execute a workflow on the v3 server */
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as WorkflowExecutionRequest;

    if (!body.workflowId) {
      return NextResponse.json(
        { error: "Missing required field: workflowId" },
        { status: 400 },
      );
    }

    if (!body.input || typeof body.input !== "object") {
      return NextResponse.json(
        { error: "Missing or invalid field: input (must be an object)" },
        { status: 400 },
      );
    }

    const result = await executeWorkflow(body);
    return NextResponse.json(result);
  } catch (error) {
    return apiError("workflow_execution_failed", error, { status: 502 });
  }
}
