/**
 * Default-project resolver — env override first, then unique DB row, then
 * explicit error.  Downstream code should import these functions instead of
 * hardcoding any project slug.
 *
 * The prisma client parameter is typed loosely so tests can inject a minimal
 * fake without importing the full Prisma types.
 */

import { prisma } from "@sangfor/db";

// ── Minimal interface for testability ──────────────────────────────────────

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
}

export interface PrismaClientLike {
  project: {
    findMany: (args?: { where?: Record<string, unknown>; select?: Record<string, unknown> }) => Promise<ProjectRow[]>;
  };
}

// ── Resolver: id ───────────────────────────────────────────────────────────

export async function resolveDefaultProjectId(
  client?: PrismaClientLike,
): Promise<string> {
  const env = process.env.DEFAULT_PROJECT_ID;
  if (env && env.trim().length > 0) return env.trim();

  const db = client ?? prisma;
  const rows = await db.project.findMany({
    where: { deletedAt: null },
    select: { id: true, slug: true, name: true },
  });

  if (rows.length === 0) {
    throw new Error(
      "resolveDefaultProjectId: no project found — set DEFAULT_PROJECT_ID or seed exactly one project",
    );
  }
  if (rows.length > 1) {
    throw new Error(
      `resolveDefaultProjectId: ambiguous — ${rows.length} projects exist; set DEFAULT_PROJECT_ID to disambiguate`,
    );
  }
  return rows[0]!.id;
}

// ── Resolver: slug ─────────────────────────────────────────────────────────

export async function resolveDefaultProjectSlug(
  client?: PrismaClientLike,
): Promise<string> {
  const env = process.env.DEFAULT_PROJECT_SLUG;
  if (env && env.trim().length > 0) return env.trim();

  const db = client ?? prisma;
  const rows = await db.project.findMany({
    where: { deletedAt: null },
    select: { id: true, slug: true, name: true },
  });

  if (rows.length === 0) {
    throw new Error(
      "resolveDefaultProjectSlug: no project found — set DEFAULT_PROJECT_SLUG or seed exactly one project",
    );
  }
  if (rows.length > 1) {
    throw new Error(
      `resolveDefaultProjectSlug: ambiguous — ${rows.length} projects exist; set DEFAULT_PROJECT_SLUG to disambiguate`,
    );
  }
  return rows[0]!.slug;
}
