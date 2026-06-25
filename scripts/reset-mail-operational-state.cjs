#!/usr/bin/env node
/* Reset operational/test data while preserving project, user, registry, and seed scaffolding. */
const { prisma } = require("../packages/db/src/index.ts");

const TABLES = [
  "mail_derived_candidates",
  "knowledge_chunks",
  "knowledge_documents",
  "document_versions",
  "generated_documents",
  "task_links",
  "task_status_events",
  "work_tasks",
  "poc_result_reports",
  "poc_events",
  "poc_requirements",
  "poc_issues",
  "poc_checklist_items",
  "poc_projects",
  "opportunity_stage_events",
  "opportunity_links",
  "opportunities",
  "contacts",
  "customer_partner_links",
  "customer_activity_logs",
  "customers",
  "partners",
  "improvement_candidates",
  "work_breakdown_items",
  "skill_runs",
  "reports",
  "validation_results",
  "tool_calls",
  "agent_messages",
  "agent_decision_logs",
  "agent_assignments",
  "workflow_steps",
  "workflows",
  "intent_analyses",
  "risk_analyses",
  "approval_requests",
  "command_runs",
  "codex_task_logs",
  "codex_tasks",
  "cursor_sessions",
  "github_issues",
  "run_timeline_items",
  "notification_events",
  "llm_calls",
  "test_runs",
  "build_runs",
  "changed_files",
  "code_changes",
  "pull_requests",
  "branches",
  "repositories",
];

async function count(table) {
  const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "${table}"`);
  return rows[0]?.count ?? 0;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const before = {};
  for (const table of TABLES) before[table] = await count(table);

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );

  const after = {};
  for (const table of TABLES) after[table] = await count(table);

  console.log(JSON.stringify({ resetTables: TABLES.length, before, after }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
