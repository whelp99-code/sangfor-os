import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionToken } from "@/lib/auth/session";

const { findMailMessage, findProject } = vi.hoisted(() => ({
  findMailMessage: vi.fn(),
  findProject: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  prisma: {
    mailMessage: { findFirst: findMailMessage },
    project: { findFirst: findProject },
  },
}));

import {
  enforceRequestedProject,
  isResourceInProject,
  relatedResourcesBelongToProject,
  resolveProjectScope,
} from "./project-scope";

const originalSecret = process.env.JWT_SECRET;
const originalBypass = process.env.AUTH_BYPASS_ENABLED;

beforeEach(() => {
  findProject.mockResolvedValue({ id: "project-a" });
  findMailMessage.mockResolvedValue(null);
  process.env.JWT_SECRET = "test-secret-at-least-16-chars";
  delete process.env.AUTH_BYPASS_ENABLED;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  if (originalBypass === undefined) delete process.env.AUTH_BYPASS_ENABLED;
  else process.env.AUTH_BYPASS_ENABLED = originalBypass;
});

function scopedRequest(projectId = "project-a", projectSlug = "alpha") {
  const token = createSessionToken({
    id: "user-a",
    email: "user-a@example.com",
    role: "operator",
    projectId,
    projectSlug,
  });
  return new Request("http://localhost/api/customers", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("resolveProjectScope", () => {
  it("returns project claims only when the id and slug still identify one project", async () => {
    const result = await resolveProjectScope(scopedRequest());

    expect(result).toEqual({
      ok: true,
      scope: { projectId: "project-a", projectSlug: "alpha" },
    });
    expect(findProject).toHaveBeenCalledWith({
      where: { id: "project-a", slug: "alpha" },
      select: { id: true },
    });
  });

  it("rejects a signed stale id and slug pair after a project rename or deletion", async () => {
    findProject.mockResolvedValue(null);

    const result = await resolveProjectScope(scopedRequest());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("rejects a request without a verified session when auth is configured", async () => {
    const result = await resolveProjectScope(new Request("http://localhost/api/customers"));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});

describe("project boundary helpers", () => {
  const scope = { projectId: "project-a", projectSlug: "alpha" };

  it("rejects a client-supplied foreign project slug", () => {
    expect(enforceRequestedProject(scope, "beta")?.status).toBe(403);
    expect(enforceRequestedProject(scope, "alpha")).toBeNull();
    expect(enforceRequestedProject(scope, undefined)).toBeNull();
  });

  it("recognizes direct and template-backed project ownership", () => {
    expect(isResourceInProject({ projectId: "project-a" }, scope)).toBe(true);
    expect(isResourceInProject({ template: { projectId: "project-a" } }, scope)).toBe(true);
    expect(isResourceInProject({ opportunity: { projectId: "project-a" } }, scope)).toBe(true);
    expect(isResourceInProject({ projectId: "project-b" }, scope)).toBe(false);
    expect(isResourceInProject(null, scope)).toBe(false);
  });

  it("follows a mail message through its account and rejects a foreign project", async () => {
    const allowed = await relatedResourcesBelongToProject(scope, [
      { entityType: "mail_message", entityId: "message-b" },
    ]);

    expect(allowed).toBe(false);
    expect(findMailMessage).toHaveBeenCalledWith({
      where: { id: "message-b", account: { projectId: "project-a" } },
      select: { id: true },
    });
  });

  it("fails closed for an unknown generic entity type", async () => {
    const allowed = await relatedResourcesBelongToProject(scope, [
      { entityType: "unknown_entity", entityId: "foreign-id" },
    ]);

    expect(allowed).toBe(false);
  });
});
