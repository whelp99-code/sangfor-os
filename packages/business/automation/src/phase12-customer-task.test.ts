import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("Phase 12 customer / partner core", () => {
  it("creates customer, partner, link, and contact", async () => {
    const {
      createCustomer,
      createPartner,
      linkCustomerPartner,
      createContact,
      getCustomerDetail,
    } = await import("./customer-partner");

    const customer = await createCustomer({
      projectSlug: "demo-project",
      name: `Test Customer ${Date.now()}`,
      domain: "test.example.com",
    });
    const partner = await createPartner({
      projectSlug: "demo-project",
      name: `Test Partner ${Date.now()}`,
    });
    await linkCustomerPartner(customer.id, partner.id);
    await createContact({
      customerId: customer.id,
      name: "Test Contact",
      email: "test@example.com",
    });

    const detail = await getCustomerDetail(customer.id);
    expect(detail?.partnerLinks.length).toBeGreaterThan(0);
    expect(detail?.contacts.length).toBeGreaterThan(0);
    expect(detail?.activityLogs.length).toBeGreaterThan(0);
  }, 20_000);

  it("searches and archives customers", async () => {
    const { createCustomer, searchCustomers, archiveCustomer } = await import(
      "./customer-partner"
    );
    const unique = `SearchCo ${Date.now()}`;
    await createCustomer({
      projectSlug: "demo-project",
      name: unique,
      domain: "searchco.example.com",
    });
    const found = await searchCustomers("demo-project", "SearchCo");
    expect(found.some((c) => c.name.includes("SearchCo"))).toBe(true);

    const target = found[0]!;
    const archived = await archiveCustomer(target.id);
    expect(archived.status).toBe("archived");
  }, 20_000);

  it("finds connection candidates by email domain", async () => {
    const { createCustomer, findConnectionCandidatesByEmail } = await import(
      "./customer-partner"
    );
    await createCustomer({
      projectSlug: "demo-project",
      name: `Domain Co ${Date.now()}`,
      domain: "domainmatch.example.com",
    });
    const candidates = await findConnectionCandidatesByEmail(
      "user@domainmatch.example.com",
    );
    expect(candidates.customers.length).toBeGreaterThan(0);
  }, 20_000);
});

describe.skipIf(!integrationEnabled)("Phase 12 task center", () => {
  it("creates and advances work task", async () => {
    const { createCustomer } = await import("./customer-partner");
    const { createWorkTask, updateWorkTaskStatus, listWorkTasks } =
      await import("./task-center");

    const customer = await createCustomer({
      projectSlug: "demo-project",
      name: `Task Customer ${Date.now()}`,
    });

    const task = await createWorkTask({
      projectSlug: "demo-project",
      title: "Integration test task",
      customerId: customer.id,
      priority: "high",
      status: "todo",
      source: "test",
    });
    expect(task.status).toBe("todo");

    const doing = await updateWorkTaskStatus(task.id, "doing");
    expect(doing.status).toBe("doing");

    const tasks = await listWorkTasks("demo-project");
    expect(tasks.some((t) => t.id === task.id)).toBe(true);
  }, 20_000);

  it("updates task fields and links entities", async () => {
    const { createCustomer } = await import("./customer-partner");
    const { createWorkTask, updateWorkTask, linkTaskToEntity, getWorkTaskDetail } =
      await import("./task-center");

    const customer = await createCustomer({
      projectSlug: "demo-project",
      name: `Link Customer ${Date.now()}`,
    });
    const task = await createWorkTask({
      projectSlug: "demo-project",
      title: "Link test task",
      source: "test",
      status: "todo",
      priority: "normal",
    });

    await linkTaskToEntity(task.id, {
      entityType: "customer",
      entityId: customer.id,
      linkType: "primary",
    });

    const updated = await updateWorkTask(task.id, {
      title: "Link test task updated",
      priority: "urgent",
    });
    expect(updated.title).toContain("updated");

    const detail = await getWorkTaskDetail(task.id);
    expect(detail?.links.length).toBeGreaterThan(0);
    expect(detail?.statusEvents.length).toBeGreaterThan(0);
  }, 20_000);
});

describe.skipIf(!integrationEnabled)("Wave 1 task unification", () => {
  it("migrates portal_tasks to work_tasks and lists unified portal tasks", async () => {
    const { prisma } = await import("@ai-portal/db");
    const { migratePortalTasksToWorkTasks, listUnifiedPortalTasks } = await import(
      "./task-adapter"
    );

    const project = await prisma.project.findUniqueOrThrow({
      where: { slug: "demo-project" },
    });
    await prisma.portalTask.create({
      data: {
        projectId: project.id,
        title: `Legacy portal task ${Date.now()}`,
        status: "open",
        source: "portal",
      },
    });

    const migration = await migratePortalTasksToWorkTasks();
    expect(migration.legacyCount).toBeGreaterThan(0);

    const tasks = await listUnifiedPortalTasks();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.source !== undefined)).toBe(true);
  }, 25_000);
});
