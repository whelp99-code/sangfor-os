import { randomUUID } from "node:crypto";

import { evaluateCapability, issueInternalPrincipal, type PersistedCompanyRoleAssignment } from "@sangfor/auth";
import { getInternalPrincipalConfig } from "@sangfor/config";
import { prisma } from "@sangfor/db";
import { NextRequest, NextResponse } from "next/server";

import { assertApiAccess, findCallerIdentityConflicts, stripCallerIdentityFields } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { getVerifiedSessionFromRequest } from "@/lib/auth/session";
import { buildFinanceProxyUrl, normalizeFinanceProxyBody } from "@/lib/finance-proxy";

type ParsedFinanceResponse =
  | { ok: true; data: unknown }
  | { ok: false };

function parseFinanceResponse(text: string): ParsedFinanceResponse {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    console.error("[api] finance_upstream_parse_failed:", text);
    return { ok: false };
  }
}

export async function proxyFinanceRequest(
  req: NextRequest,
  method: string,
  preauthorized = false,
) {
  if (!preauthorized) {
    const denied = assertApiAccess(req);
    if (denied) return denied;
  }
  if (method !== "GET" && method !== "HEAD") {
    const capabilityDenied = await assertBusinessCapability(req, "apps/web/src/app/api/finance/[...path]/route.ts");
    if (capabilityDenied) return capabilityDenied;
  }

  const financeApiKey = process.env.FINANCE_API_KEY?.trim();
  if (!financeApiKey) {
    return NextResponse.json({ error: "AUTH_CONFIGURATION_UNAVAILABLE" }, { status: 503 });
  }

  const session = getVerifiedSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [project, persistedSession, companyRoles] = await Promise.all([
    prisma.project.findUnique({ where: { id: session.projectId }, select: { id: true, companyId: true, company: { select: { tenantId: true } } } }),
    prisma.authSession.findFirst({
      where: { userId: session.id, projectId: session.projectId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { issuedAt: "desc" },
      select: { id: true, tenantId: true, companyId: true, projectId: true },
    }),
    prisma.userCompanyRole.findMany({
      where: { userId: session.id },
      select: { id: true, userId: true, companyId: true, role: true, status: true, validFrom: true, expiresAt: true, revokedAt: true },
    }),
  ]);
  if (!project?.companyId || !project.company?.tenantId || !persistedSession || persistedSession.projectId !== project.id || persistedSession.companyId !== project.companyId || persistedSession.tenantId !== project.company.tenantId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const capability = evaluateCapability({
    companyRoleAssignments: companyRoles as PersistedCompanyRoleAssignment[],
    projectAssignment: null,
    definition: { capabilityClass: "company-scoped" },
    now: new Date(),
  });
  const financeCapabilities = capability.ok ? capability.permissions.filter((entry) => ["finance.read", "finance.write", "finance.approve_margin"].includes(entry)) : [];
  if (!capability.ok || !capability.role || financeCapabilities.length === 0) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = buildFinanceProxyUrl(req.nextUrl.pathname, req.nextUrl.search);
  const headers: Record<string, string> = { "X-API-Key": financeApiKey };
  const init: RequestInit & { headers: Record<string, string> } = { method, headers };
  let normalizedBody = "";
  if (method !== "GET" && method !== "HEAD") {
    const body = await req.json().catch(() => undefined);
    if (body !== undefined) {
      if (findCallerIdentityConflicts(body, session.id).length > 0) {
        return NextResponse.json({ error: "IDENTITY_CONFLICT" }, { status: 400 });
      }
      headers["Content-Type"] = "application/json";
      normalizedBody = normalizeFinanceProxyBody(stripCallerIdentityFields(body));
      init.body = normalizedBody;
    }
  }
  try {
    headers["X-Sangfor-Internal-Principal"] = issueInternalPrincipal({
      profile: "FINANCE",
      subjectType: "human_delegation",
      subjectId: session.id,
      sessionId: persistedSession.id,
      tenantId: persistedSession.tenantId,
      companyId: persistedSession.companyId,
      projectId: persistedSession.projectId,
      businessRole: capability.role,
      capabilities: financeCapabilities,
      method,
      path: new URL(url).pathname,
      query: new URL(url).search,
      body: normalizedBody,
      idempotencyKey: randomUUID(),
    }, getInternalPrincipalConfig());
  } catch {
    return NextResponse.json({ error: "AUTH_CONFIGURATION_UNAVAILABLE" }, { status: 503 });
  }
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    if (!text) return NextResponse.json(null, { status: res.status });
    const parsed = parseFinanceResponse(text);
    if (!parsed.ok) return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
    return NextResponse.json(parsed.data, { status: res.status });
  } catch (error) {
    console.error("[api] finance_proxy_unavailable:", error instanceof Error ? error.stack ?? error.message : error);
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}
