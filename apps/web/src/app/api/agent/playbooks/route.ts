import { playbookStore } from "@/lib/agent/playbook-store";
import { assertApiAccess } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/** GET /api/agent/playbooks — list saved playbooks. */
export async function GET() {
  return Response.json({ playbooks: await playbookStore.list() });
}

/** POST /api/agent/playbooks — create a playbook. Body: { name, goal, allowUnsafe?, maxSteps? } */
export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  let body: { name?: unknown; goal?: unknown; allowUnsafe?: unknown; maxSteps?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!name || !goal) {
    return Response.json({ error: "name and goal are required" }, { status: 400 });
  }
  try {
    const playbook = await playbookStore.create({
      name,
      goal,
      allowUnsafe: body.allowUnsafe === true,
      maxSteps: typeof body.maxSteps === "number" ? body.maxSteps : undefined,
    });
    return Response.json({ playbook }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
      return Response.json({ error: "a playbook with this name already exists" }, { status: 409 });
    }
    throw error;
  }
}
