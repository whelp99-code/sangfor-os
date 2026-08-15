import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(
    __dirname,
    "../prisma/migrations/20260812190000_unify_autopilot_policy_key/migration.sql",
  ),
  "utf8",
);

describe("autopilot policy-key migration", () => {
  it("renames non-conflicting legacy rows before deleting leftovers", () => {
    const updateIndex = migrationSql.indexOf(
      'UPDATE "autonomy_policies" AS legacy',
    );
    const deleteIndex = migrationSql.indexOf(
      'DELETE FROM "autonomy_policies"',
    );

    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeGreaterThan(updateIndex);
    expect(migrationSql).toContain("AND NOT EXISTS (");
    expect(migrationSql).toContain(
      "canonical.\"decisionType\" = 'autopilot_approve'",
    );
    expect(migrationSql).toMatch(
      /DELETE FROM "autonomy_policies"\s+WHERE "decisionType" = 'mail_candidate_approve';/u,
    );
  });
});
