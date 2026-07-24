import {
  connectMockOutlook,
  getPortalOverview,
  listPortalTasks,
  resolveCrmAuthContext,
  syncMockMail,
} from "@sangfor/business";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

const connectSchema = z.object({ action: z.literal("connect-outlook") }).strict();
const syncSchema = z.object({
  action: z.literal("sync-mail"),
  expectedAccountUpdatedAt: z.string().datetime({ offset: true }),
}).strict();
const SCOPE_FIELDS = new Set([
  "projectSlug",
  "tenantId",
  "companyId",
  "projectId",
  "actor",
  "assignmentId",
  "role",
]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function requestKey(request: Request): string | null {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  return value.length > 0 && value.length <= 128 && !CONTROL_CHARACTERS.test(value)
    ? value
    : null;
}

async function resolveContext(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return { ok: false as const, response: denied };
  const session = await evaluatePersistedSessionFromRequest(request);
  if (!session.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  try {
    return {
      ok: true as const,
      ctx: await resolveCrmAuthContext({
        userId: session.userId,
        sessionId: null,
        tenantId: session.tenantId,
        companyId: session.companyId,
        projectId: session.projectId,
        product: "portal",
      }),
    };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
}

export async function GET(request: Request) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  try {
    const [overview, tasks] = await Promise.all([
      getPortalOverview(auth.ctx),
      listPortalTasks(auth.ctx),
    ]);
    return NextResponse.json({ overview, tasks });
  } catch (error) {
    return apiError("portal_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const idempotencyKey = requestKey(request);
  if (!idempotencyKey) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).some((field) => SCOPE_FIELDS.has(field))
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const connect = connectSchema.safeParse(input);
    if (connect.success) {
      const account = await connectMockOutlook(auth.ctx, { idempotencyKey });
      return NextResponse.json({ account });
    }
    const sync = syncSchema.safeParse(input);
    if (sync.success) {
      const messages = await syncMockMail(auth.ctx, {
        expectedAccountUpdatedAt: sync.data.expectedAccountUpdatedAt,
        idempotencyKey,
      });
      return NextResponse.json({ messages });
    }
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  } catch (error) {
    return apiError("portal_action_failed", error, { status: 400 });
  }
}
