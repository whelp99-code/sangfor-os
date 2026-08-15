import {
  approveMailDerivedCandidate,
  executeScopedMailCandidateManualCommand,
  getScopedMailDerivedCandidate,
  revalidateMailDerivedCandidate,
} from "@sangfor/business/mail-candidates";
import {
  getScopedMailCandidateGroundTruthPreview,
  resolveCrmAuthContext,
} from "@sangfor/business";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { approvedMailGroundTruthManifest } from "@/lib/mail-ground-truth";

type Params = { params: Promise<{ id: string }> };
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({
    action: z.literal("revalidate"),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    force: z.boolean().optional(),
  }).strict(),
  z.object({
    action: z.literal("reject"),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    reasonCode: z.string().trim().min(1).max(100),
    note: z.string().trim().max(2_000).optional(),
  }).strict(),
  z.object({
    action: z.literal("set_candidate_type"),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    candidateType: z.enum(["customer", "partner"]),
  }).strict(),
]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCOPE_FIELDS = new Set([
  "tenantId",
  "companyId",
  "projectId",
  "projectSlug",
  "actor",
  "assignmentId",
  "role",
]);

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

function commandError(error: unknown) {
  if (
    error instanceof Error &&
    "httpStatus" in error &&
    typeof error.httpStatus === "number" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return NextResponse.json({ error: error.code }, { status: error.httpStatus });
  }
  return apiError("mail_candidate_command_failed", error, { status: 400 });
}

export async function GET(request: Request, { params }: Params) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const preview = new URL(request.url).searchParams.get("preview");
  if (preview !== null) {
    if (preview !== "ground_truth") {
      return NextResponse.json({ error: "validation_error" }, { status: 422 });
    }
    const report = await getScopedMailCandidateGroundTruthPreview(
      auth.ctx,
      id,
      approvedMailGroundTruthManifest,
    );
    if (!report) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { preview: "ground_truth", ...report },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const candidate = await getScopedMailDerivedCandidate(auth.ctx, id);
  if (!candidate) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ candidate });
}

export async function PATCH(request: Request, { params }: Params) {
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
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }
  const { id } = await params;
  try {
    if (parsed.data.action === "approve") {
      const result = await approveMailDerivedCandidate(auth.ctx, id, {
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
        idempotencyKey,
      });
      return NextResponse.json(result);
    }
    if (parsed.data.action === "revalidate") {
      const result = await revalidateMailDerivedCandidate(auth.ctx, id, {
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
        idempotencyKey,
        force: parsed.data.force === true,
      });
      return NextResponse.json(result);
    }
    const candidate = await executeScopedMailCandidateManualCommand(auth.ctx, id, {
      ...parsed.data,
      idempotencyKey,
    });
    return NextResponse.json({ candidate });
  } catch (error) {
    return commandError(error);
  }
}
