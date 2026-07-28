/**
 * U043 quarantine: executable CRM backfills cannot bypass scoped commands.
 * Use a reviewed, task-owned migration with explicit scope and audit evidence.
 */
throw new Error("backfill-migrations is retired: direct CRM maintenance is not permitted");
