import {
  addPocEvent,
  addPocIssue,
  addPocRequirement,
  generatePocResultReport,
  getPocDetail,
  togglePocChecklistItem,
  updatePocIssue,
  updatePocProject,
} from "@ai-portal/automation";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const project = await getPocDetail(id);
    if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "fetch_failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const action = body.action as string | undefined;

    if (action === "toggle_checklist") {
      const item = await togglePocChecklistItem(body.itemId, Boolean(body.done));
      return NextResponse.json({ item });
    }
    if (action === "add_issue") {
      const issue = await addPocIssue(id, body.title, body.severity);
      return NextResponse.json({ issue }, { status: 201 });
    }
    if (action === "update_issue") {
      const issue = await updatePocIssue(body.issueId, {
        status: body.status,
        severity: body.severity,
        title: body.title,
      });
      return NextResponse.json({ issue });
    }
    if (action === "add_requirement") {
      const requirement = await addPocRequirement(id, {
        label: body.label,
        details: body.details,
      });
      return NextResponse.json({ requirement }, { status: 201 });
    }
    if (action === "add_event") {
      const event = await addPocEvent(id, {
        eventType: body.eventType,
        summary: body.summary,
        occurredAt: body.occurredAt,
      });
      return NextResponse.json({ event }, { status: 201 });
    }
    if (action === "generate_report") {
      const report = await generatePocResultReport(id);
      return NextResponse.json({ report }, { status: 201 });
    }

    if (action) {
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
    }

    const project = await updatePocProject(id, body);
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "update_failed" },
      { status: 400 },
    );
  }
}
