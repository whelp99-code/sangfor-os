/**
 * Backfill project_scoped rows for delivery_projects where project_id IS NULL.
 *
 * The data facts (surveyed) are:
 *   - `projects` table has exactly 1 row (id cmr0v0ka800009kcconlrgher, slug demo-project).
 *   - All tables with a project_id column EXCEPT delivery_projects are already
 *     100% project-linked. Only delivery_projects (model Engagement) has NULLs:
 *     9 of 12 rows as of the survey.
 *
 * Safety: aborts unless `DEFAULT_PROJECT_ID` env is set OR the projects table
 * contains exactly one row.
 *
 * DRY-RUN by default (prints counts and IDs).  Pass env APPLY=1 to persist.
 *
 * Usage:
 *   pnpm --filter @sangfor/db backfill:project-scope            # dry-run
 *   APPLY=1 pnpm --filter @sangfor/db backfill:project-scope     # actually write
 *
 * Idempotent: only touches rows WHERE project_id IS NULL so re-running
 * never double-writes.
 */
import { prisma } from "../src/index";

const APPLY = process.env.APPLY === "1";

// ── Inline default-project resolver ────────────────────────────────────────
// The db package cannot depend on @sangfor/business, so we duplicate the
// logic from packages/business/src/default-project.ts with a comment
// referencing the canonical source.

async function resolveDefaultProjectId(): Promise<string> {
  const env = process.env.DEFAULT_PROJECT_ID;
  if (env && env.trim().length > 0) return env.trim();

  const rows = await prisma.project.findMany({
    select: { id: true, slug: true, name: true },
  });

  if (rows.length === 0) {
    throw new Error(
      "No project found — set DEFAULT_PROJECT_ID env or seed exactly one project row.",
    );
  }
  if (rows.length > 1) {
    throw new Error(
      `Ambiguous: ${rows.length} projects exist. Set DEFAULT_PROJECT_ID env to disambiguate.`,
    );
  }
  return rows[0]!.id;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  // -----------------------------------------------------------------------
  // Safety guard
  // -----------------------------------------------------------------------
  const projectId = await resolveDefaultProjectId();

  // -----------------------------------------------------------------------
  // Count current NULLs
  // -----------------------------------------------------------------------
  const totalNull = await prisma.engagement.count({
    where: { projectId: null },
  });

  if (totalNull === 0) {
    console.log("✓ No NULL project_id rows in delivery_projects — nothing to do.");
    return;
  }

  // -----------------------------------------------------------------------
  // Fetch the exact rows that would be updated (for transparency)
  // -----------------------------------------------------------------------
  const nullRows = await prisma.engagement.findMany({
    where: { projectId: null },
    select: { id: true, name: true, status: true },
    orderBy: { id: "asc" },
  });

  console.log(`mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);
  console.log(`target project_id: ${projectId}`);
  console.log(`rows with NULL project_id: ${nullRows.length}\n`);

  console.log("Rows to backfill:");
  for (const row of nullRows) {
    console.log(`  • ${row.id}  "${row.name}"  [${row.status}]`);
  }

  if (!APPLY) {
    console.log(`\n→ Re-run with APPLY=1 to set project_id = ${projectId} on ${nullRows.length} rows.`);
    return;
  }

  // -----------------------------------------------------------------------
  // Apply: fill project_id on all NULL rows
  // -----------------------------------------------------------------------
  const result = await prisma.engagement.updateMany({
    where: { projectId: null },
    data: { projectId },
  });

  // Verify — recount how many NULLs remain
  const remainingNull = await prisma.engagement.count({
    where: { projectId: null },
  });

  console.log(`\nUpdated: ${result.count} delivery_projects`);
  console.log(`Remaining NULL: ${remainingNull}`);
  if (remainingNull === 0) {
    console.log("✓ All delivery_projects now have a project_id.");
  } else {
    console.log(`⚠️  ${remainingNull} row(s) still NULL — investigate.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
