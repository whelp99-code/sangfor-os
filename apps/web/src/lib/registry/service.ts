import { prisma } from "@ai-portal/db";

export type RegistryCounts = {
  modules: number;
  blocks: number;
  queries: number;
  slots: number;
  nodes: number;
  connectors: number;
};

export type CommandRunStats = {
  total: number;
  running: number;
  pending: number;
};

export type PageBlock = {
  slotKey: string;
  sortOrder: number;
  blockKey: string;
  moduleKey: string;
  displayName: string;
  queryKey?: string;
  data: unknown;
};

/**
 * Purpose:
 * - Execute query_registry handlers for Block rendering (Phase 3).
 *
 * Failure Points:
 * - Unknown handler keys return empty payloads — blocks must handle empty state.
 *
 * Observability:
 * - audit.error_events (future)
 */
export async function runQueryHandler(
  queryKey: string,
): Promise<unknown> {
  const query = await prisma.queryRegistry.findUnique({
    where: { queryKey },
  });
  if (!query) return null;

  const config = query.configJson as { handler?: string };
  switch (config.handler) {
    case "registry_counts":
      return getRegistryCounts();
    case "command_run_stats":
      return getCommandRunStats();
    case "command_run_detail":
      return prisma.commandRun.findFirst({
        orderBy: { createdAt: "desc" },
        include: {
          workflows: { include: { steps: true } },
        },
      });
    case "customer_list": {
      const { listCustomers } = await import("@ai-portal/automation");
      return listCustomers();
    }
    case "task_board": {
      const { listWorkTasks } = await import("@ai-portal/automation");
      return listWorkTasks();
    }
    case "task_today": {
      const { listTodayTasks } = await import("@ai-portal/automation");
      return listTodayTasks();
    }
    case "customer_detail": {
      const { listCustomers } = await import("@ai-portal/automation");
      const rows = await listCustomers();
      return rows[0] ?? null;
    }
    case "partner_list": {
      const { listPartners } = await import("@ai-portal/automation");
      return listPartners();
    }
    case "contact_list": {
      const { prisma: db } = await import("@ai-portal/db");
      return db.contact.findMany({ take: 20, orderBy: { createdAt: "desc" } });
    }
    case "customer_activity": {
      const { prisma: db } = await import("@ai-portal/db");
      return db.customerActivityLog.findMany({
        take: 20,
        orderBy: { createdAt: "desc" },
      });
    }
    case "task_list": {
      const { listWorkTasks } = await import("@ai-portal/automation");
      return listWorkTasks();
    }
    case "task_detail": {
      const { listWorkTasks } = await import("@ai-portal/automation");
      const rows = await listWorkTasks();
      return rows[0] ?? null;
    }
    case "poc_project_list": {
      const { listPocProjects } = await import("@ai-portal/automation");
      return listPocProjects();
    }
    case "poc_project_detail": {
      const { listPocProjects, getPocDetail } = await import("@ai-portal/automation");
      const rows = await listPocProjects();
      return rows[0] ? getPocDetail(rows[0].id) : null;
    }
    case "poc_checklist": {
      const { listPocProjects, getPocDetail } = await import("@ai-portal/automation");
      const rows = await listPocProjects();
      const detail = rows[0] ? await getPocDetail(rows[0].id) : null;
      return detail?.checklistItems ?? [];
    }
    case "poc_report": {
      const { prisma: db } = await import("@ai-portal/db");
      return db.pocResultReport.findMany({ take: 5, orderBy: { createdAt: "desc" } });
    }
    case "opportunity_list": {
      const { listOpportunities } = await import("@ai-portal/automation");
      return listOpportunities();
    }
    case "opportunity_pipeline": {
      const { getOpportunityPipelineSummary } = await import("@ai-portal/automation");
      return getOpportunityPipelineSummary();
    }
    case "opportunity_detail": {
      const { listOpportunities, getOpportunityDetail } = await import("@ai-portal/automation");
      const rows = await listOpportunities();
      return rows[0] ? getOpportunityDetail(rows[0].id) : null;
    }
    case "proposal_list": {
      const { listGeneratedDocuments } = await import("@ai-portal/automation");
      return listGeneratedDocuments();
    }
    case "knowledge_search": {
      const { listKnowledgeDocuments } = await import("@ai-portal/automation");
      return listKnowledgeDocuments();
    }
    case "dashboard_today_summary": {
      const { getDashboardWidgets } = await import("@ai-portal/automation");
      const w = await getDashboardWidgets();
      return { todayTasks: w.todayTasks, urgentCount: w.urgentTasks.length };
    }
    case "dashboard_urgent_tasks": {
      const { getDashboardWidgets } = await import("@ai-portal/automation");
      return (await getDashboardWidgets()).urgentTasks;
    }
    case "dashboard_dev_status": {
      const { getDashboardWidgets } = await import("@ai-portal/automation");
      return (await getDashboardWidgets()).devStatus;
    }
    default:
      return null;
  }
}

export async function getRegistryCounts(): Promise<RegistryCounts> {
  const [modules, blocks, queries, slots, nodes, connectors] =
    await Promise.all([
      prisma.moduleRegistry.count(),
      prisma.blockRegistry.count(),
      prisma.queryRegistry.count(),
      prisma.layoutSlot.count(),
      prisma.nodeRegistry.count(),
      prisma.connectorRegistry.count(),
    ]);

  return { modules, blocks, queries, slots, nodes, connectors };
}

export async function getCommandRunStats(): Promise<CommandRunStats> {
  const [total, running, pending] = await Promise.all([
    prisma.commandRun.count(),
    prisma.commandRun.count({ where: { status: "running" } }),
    prisma.commandRun.count({ where: { status: "pending" } }),
  ]);
  return { total, running, pending };
}

export async function loadPageBlocks(pageKey: string): Promise<PageBlock[]> {
  const slots = await prisma.layoutSlot.findMany({
    where: { pageKey },
    orderBy: { sortOrder: "asc" },
    include: { block: true },
  });

  const blocks: PageBlock[] = [];

  for (const slot of slots) {
    if (!slot.block) continue;
    const config = (slot.block.configJson ?? {}) as { queryKey?: string };
    const data = config.queryKey
      ? await runQueryHandler(config.queryKey)
      : null;

    blocks.push({
      slotKey: slot.slotKey,
      sortOrder: slot.sortOrder,
      blockKey: slot.block.blockKey,
      moduleKey: slot.block.moduleKey,
      displayName: slot.block.displayName,
      queryKey: config.queryKey,
      data,
    });
  }

  return blocks;
}

export async function listRegistryAdminRows() {
  const [modules, blocks, queries, slots, nodes, connectors] =
    await Promise.all([
      prisma.moduleRegistry.findMany({ orderBy: { moduleKey: "asc" } }),
      prisma.blockRegistry.findMany({ orderBy: { blockKey: "asc" } }),
      prisma.queryRegistry.findMany({ orderBy: { queryKey: "asc" } }),
      prisma.layoutSlot.findMany({
        orderBy: [{ pageKey: "asc" }, { sortOrder: "asc" }],
        include: { block: true },
      }),
      prisma.nodeRegistry.findMany({ orderBy: { nodeKey: "asc" } }),
      prisma.connectorRegistry.findMany({ orderBy: { connectorKey: "asc" } }),
    ]);

  return { modules, blocks, queries, slots, nodes, connectors };
}
