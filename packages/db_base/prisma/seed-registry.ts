import type { PrismaClient } from "@prisma/client";

/**
 * Purpose:
 * - Seed module/block/query/layout/node/connector registry rows for Phase 3 UI binding.
 */
export async function seedRegistry(tx: PrismaClient) {
  const modules = [
    {
      moduleKey: "dashboard",
      displayName: "Dashboard Module",
      version: "0.1.0",
    },
    {
      moduleKey: "command-center",
      displayName: "Command Center Module",
      version: "0.1.0",
    },
    {
      moduleKey: "registry-admin",
      displayName: "Registry Admin Module",
      version: "0.1.0",
    },
    {
      moduleKey: "customer",
      displayName: "Customer Module",
      version: "0.1.0",
    },
    {
      moduleKey: "task",
      displayName: "Task Center Module",
      version: "0.1.0",
    },
    {
      moduleKey: "partner",
      displayName: "Partner Module",
      version: "0.1.0",
    },
    {
      moduleKey: "poc",
      displayName: "PoC Module",
      version: "0.1.0",
    },
    {
      moduleKey: "opportunity",
      displayName: "Opportunity Module",
      version: "0.1.0",
    },
    {
      moduleKey: "proposal",
      displayName: "Proposal Module",
      version: "0.1.0",
    },
    {
      moduleKey: "knowledge",
      displayName: "Knowledge Module",
      version: "0.1.0",
    },
  ] as const;

  for (const mod of modules) {
    await tx.moduleRegistry.upsert({
      where: { moduleKey: mod.moduleKey },
      update: { displayName: mod.displayName, version: mod.version },
      create: mod,
    });
  }

  const blocks = [
    {
      blockKey: "dashboard-metrics",
      moduleKey: "dashboard",
      displayName: "Dashboard Metrics",
      configJson: { queryKey: "registry_counts" },
    },
    {
      blockKey: "command-run-summary",
      moduleKey: "command-center",
      displayName: "Command Run Summary",
      configJson: { queryKey: "command_run_stats" },
    },
    {
      blockKey: "registry-stats",
      moduleKey: "registry-admin",
      displayName: "Registry Stats",
      configJson: { queryKey: "registry_counts" },
    },
    {
      blockKey: "customer.customer-list",
      moduleKey: "customer",
      displayName: "Customer List",
      configJson: { queryKey: "customer_list" },
    },
    {
      blockKey: "task.task-board",
      moduleKey: "task",
      displayName: "Task Board",
      configJson: { queryKey: "task_board" },
    },
    {
      blockKey: "task.my-today-tasks",
      moduleKey: "task",
      displayName: "My Today Tasks",
      configJson: { queryKey: "task_today" },
    },
    {
      blockKey: "customer.customer-detail",
      moduleKey: "customer",
      displayName: "Customer Detail",
      configJson: { queryKey: "customer_detail" },
    },
    {
      blockKey: "partner.partner-list",
      moduleKey: "partner",
      displayName: "Partner List",
      configJson: { queryKey: "partner_list" },
    },
    {
      blockKey: "contact.contact-list",
      moduleKey: "customer",
      displayName: "Contact List",
      configJson: { queryKey: "contact_list" },
    },
    {
      blockKey: "customer.activity-timeline",
      moduleKey: "customer",
      displayName: "Activity Timeline",
      configJson: { queryKey: "customer_activity" },
    },
    {
      blockKey: "task.task-list",
      moduleKey: "task",
      displayName: "Task List",
      configJson: { queryKey: "task_list" },
    },
    {
      blockKey: "task.task-detail",
      moduleKey: "task",
      displayName: "Task Detail",
      configJson: { queryKey: "task_detail" },
    },
    {
      blockKey: "poc.poc-project-list",
      moduleKey: "poc",
      displayName: "PoC Project List",
      configJson: { queryKey: "poc_project_list" },
    },
    {
      blockKey: "poc.poc-project-detail",
      moduleKey: "poc",
      displayName: "PoC Project Detail",
      configJson: { queryKey: "poc_project_detail" },
    },
    {
      blockKey: "poc.poc-checklist",
      moduleKey: "poc",
      displayName: "PoC Checklist",
      configJson: { queryKey: "poc_checklist" },
    },
    {
      blockKey: "poc.poc-report",
      moduleKey: "poc",
      displayName: "PoC Result Report",
      configJson: { queryKey: "poc_report" },
    },
    {
      blockKey: "opportunity.opportunity-list",
      moduleKey: "opportunity",
      displayName: "Opportunity List",
      configJson: { queryKey: "opportunity_list" },
    },
    {
      blockKey: "opportunity.pipeline-board",
      moduleKey: "opportunity",
      displayName: "Pipeline Board",
      configJson: { queryKey: "opportunity_pipeline" },
    },
    {
      blockKey: "opportunity.opportunity-detail",
      moduleKey: "opportunity",
      displayName: "Opportunity Detail",
      configJson: { queryKey: "opportunity_detail" },
    },
    {
      blockKey: "proposal.proposal-list",
      moduleKey: "proposal",
      displayName: "Proposal List",
      configJson: { queryKey: "proposal_list" },
    },
    {
      blockKey: "knowledge.knowledge-search",
      moduleKey: "knowledge",
      displayName: "Knowledge Search",
      configJson: { queryKey: "knowledge_search" },
    },
    {
      blockKey: "dashboard.today-summary",
      moduleKey: "dashboard",
      displayName: "Today Summary",
      configJson: { queryKey: "dashboard_today_summary" },
    },
    {
      blockKey: "dashboard.urgent-tasks",
      moduleKey: "dashboard",
      displayName: "Urgent Tasks",
      configJson: { queryKey: "dashboard_urgent_tasks" },
    },
    {
      blockKey: "dashboard.dev-status",
      moduleKey: "dashboard",
      displayName: "Dev Status",
      configJson: { queryKey: "dashboard_dev_status" },
    },
    {
      blockKey: "proposal.proposal-detail",
      moduleKey: "proposal",
      displayName: "Proposal Detail",
      configJson: { queryKey: "proposal_list" },
    },
    {
      blockKey: "knowledge.knowledge-document",
      moduleKey: "knowledge",
      displayName: "Knowledge Document",
      configJson: { queryKey: "knowledge_search" },
    },
    {
      blockKey: "poc.poc-issue-board",
      moduleKey: "poc",
      displayName: "PoC Issue Board",
      configJson: { queryKey: "poc_project_detail" },
    },
  ] as const;

  for (const block of blocks) {
    await tx.blockRegistry.upsert({
      where: { blockKey: block.blockKey },
      update: {
        displayName: block.displayName,
        configJson: block.configJson,
        moduleKey: block.moduleKey,
      },
      create: block,
    });
  }

  const queries = [
    {
      queryKey: "registry_counts",
      sourceType: "prisma",
      configJson: {
        handler: "registry_counts",
      },
    },
    {
      queryKey: "command_run_stats",
      sourceType: "prisma",
      configJson: {
        handler: "command_run_stats",
      },
    },
    {
      queryKey: "command_run_detail",
      sourceType: "prisma",
      configJson: {
        handler: "command_run_detail",
        include: ["workflows", "workflows.steps"],
      },
    },
    {
      queryKey: "customer_list",
      sourceType: "prisma",
      configJson: { handler: "customer_list" },
    },
    {
      queryKey: "task_board",
      sourceType: "prisma",
      configJson: { handler: "task_board" },
    },
    {
      queryKey: "task_today",
      sourceType: "prisma",
      configJson: { handler: "task_today" },
    },
    {
      queryKey: "customer_detail",
      sourceType: "prisma",
      configJson: { handler: "customer_detail" },
    },
    {
      queryKey: "partner_list",
      sourceType: "prisma",
      configJson: { handler: "partner_list" },
    },
    {
      queryKey: "contact_list",
      sourceType: "prisma",
      configJson: { handler: "contact_list" },
    },
    {
      queryKey: "customer_activity",
      sourceType: "prisma",
      configJson: { handler: "customer_activity" },
    },
    {
      queryKey: "task_list",
      sourceType: "prisma",
      configJson: { handler: "task_list" },
    },
    {
      queryKey: "task_detail",
      sourceType: "prisma",
      configJson: { handler: "task_detail" },
    },
    {
      queryKey: "poc_project_list",
      sourceType: "prisma",
      configJson: { handler: "poc_project_list" },
    },
    {
      queryKey: "poc_project_detail",
      sourceType: "prisma",
      configJson: { handler: "poc_project_detail" },
    },
    {
      queryKey: "poc_checklist",
      sourceType: "prisma",
      configJson: { handler: "poc_checklist" },
    },
    {
      queryKey: "poc_report",
      sourceType: "prisma",
      configJson: { handler: "poc_report" },
    },
    {
      queryKey: "opportunity_list",
      sourceType: "prisma",
      configJson: { handler: "opportunity_list" },
    },
    {
      queryKey: "opportunity_pipeline",
      sourceType: "prisma",
      configJson: { handler: "opportunity_pipeline" },
    },
    {
      queryKey: "opportunity_detail",
      sourceType: "prisma",
      configJson: { handler: "opportunity_detail" },
    },
    {
      queryKey: "proposal_list",
      sourceType: "prisma",
      configJson: { handler: "proposal_list" },
    },
    {
      queryKey: "knowledge_search",
      sourceType: "prisma",
      configJson: { handler: "knowledge_search" },
    },
    {
      queryKey: "dashboard_today_summary",
      sourceType: "prisma",
      configJson: { handler: "dashboard_today_summary" },
    },
    {
      queryKey: "dashboard_urgent_tasks",
      sourceType: "prisma",
      configJson: { handler: "dashboard_urgent_tasks" },
    },
    {
      queryKey: "dashboard_dev_status",
      sourceType: "prisma",
      configJson: { handler: "dashboard_dev_status" },
    },
  ] as const;

  for (const query of queries) {
    await tx.queryRegistry.upsert({
      where: { queryKey: query.queryKey },
      update: { configJson: query.configJson, sourceType: query.sourceType },
      create: query,
    });
  }

  const dashboardMetrics = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "dashboard-metrics" },
  });
  const commandSummary = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "command-run-summary" },
  });
  const registryStats = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "registry-stats" },
  });
  const customerList = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "customer.customer-list" },
  });
  const taskBoard = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "task.task-board" },
  });
  const partnerList = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "partner.partner-list" },
  });
  const pocList = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "poc.poc-project-list" },
  });
  const pipelineBoard = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "opportunity.pipeline-board" },
  });
  const proposalList = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "proposal.proposal-list" },
  });
  const knowledgeSearch = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "knowledge.knowledge-search" },
  });
  const todaySummary = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "dashboard.today-summary" },
  });
  const urgentTasks = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "dashboard.urgent-tasks" },
  });
  const devStatus = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "dashboard.dev-status" },
  });
  const proposalDetail = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "proposal.proposal-detail" },
  });
  const knowledgeDocument = await tx.blockRegistry.findUniqueOrThrow({
    where: { blockKey: "knowledge.knowledge-document" },
  });

  const slots = [
    {
      pageKey: "dashboard",
      slotKey: "main",
      sortOrder: 1,
      blockRegistryId: dashboardMetrics.id,
    },
    {
      pageKey: "dashboard",
      slotKey: "today",
      sortOrder: 2,
      blockRegistryId: todaySummary.id,
    },
    {
      pageKey: "dashboard",
      slotKey: "urgent",
      sortOrder: 3,
      blockRegistryId: urgentTasks.id,
    },
    {
      pageKey: "dashboard",
      slotKey: "dev",
      sortOrder: 4,
      blockRegistryId: devStatus.id,
    },
    {
      pageKey: "commands",
      slotKey: "header",
      sortOrder: 1,
      blockRegistryId: commandSummary.id,
    },
    {
      pageKey: "registry",
      slotKey: "main",
      sortOrder: 1,
      blockRegistryId: registryStats.id,
    },
    {
      pageKey: "customers",
      slotKey: "main",
      sortOrder: 1,
      blockRegistryId: customerList.id,
    },
    {
      pageKey: "tasks",
      slotKey: "main",
      sortOrder: 1,
      blockRegistryId: taskBoard.id,
    },
    {
      pageKey: "partners",
      slotKey: "main",
      sortOrder: 1,
      blockRegistryId: partnerList.id,
    },
    {
      pageKey: "poc",
      slotKey: "main",
      sortOrder: 1,
      blockRegistryId: pocList.id,
    },
    {
      pageKey: "opportunities",
      slotKey: "main",
      sortOrder: 1,
      blockRegistryId: pipelineBoard.id,
    },
    {
      pageKey: "proposals",
      slotKey: "main",
      sortOrder: 1,
      blockRegistryId: proposalList.id,
    },
    {
      pageKey: "proposals",
      slotKey: "detail",
      sortOrder: 2,
      blockRegistryId: proposalDetail.id,
    },
    {
      pageKey: "knowledge",
      slotKey: "main",
      sortOrder: 1,
      blockRegistryId: knowledgeSearch.id,
    },
    {
      pageKey: "knowledge",
      slotKey: "document",
      sortOrder: 2,
      blockRegistryId: knowledgeDocument.id,
    },
  ] as const;

  for (const slot of slots) {
    await tx.layoutSlot.upsert({
      where: {
        pageKey_slotKey: { pageKey: slot.pageKey, slotKey: slot.slotKey },
      },
      update: {
        blockRegistryId: slot.blockRegistryId,
        sortOrder: slot.sortOrder,
      },
      create: slot,
    });
  }

  await tx.nodeRegistry.upsert({
    where: { nodeKey: "validate-lint-test-build" },
    update: {},
    create: {
      nodeKey: "validate-lint-test-build",
      moduleKey: "command-center",
      nodeType: "validation",
      configJson: { checks: ["lint", "test", "build"] },
    },
  });

  await tx.connectorRegistry.upsert({
    where: { connectorKey: "github" },
    update: {},
    create: {
      connectorKey: "github",
      displayName: "GitHub",
      connectorType: "vcs",
      status: "active",
    },
  });
}
