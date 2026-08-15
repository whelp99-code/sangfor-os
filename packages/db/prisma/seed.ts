import { prisma } from "../src/index";
import { seedAutopilotPolicies } from "../src/autonomy-policy-seed";

async function upsertPolicyMemory(projectId: string, memoryType: string, key: string, label: string) {
  await prisma.policyMemory.upsert({
    where: {
      projectId_memoryType_key: {
        projectId,
        memoryType,
        key,
      },
    },
    update: {
      label,
      valueJson: { key, label },
      source: "seed",
      confidence: 100,
      status: "active",
    },
    create: {
      projectId,
      memoryType,
      key,
      label,
      valueJson: { key, label },
      source: "seed",
      confidence: 100,
      status: "active",
    },
  });
}

async function seedDashboardRegistry() {
  await prisma.moduleRegistry.upsert({
    where: { moduleKey: "dashboard" },
    update: { displayName: "Dashboard", status: "active" },
    create: { moduleKey: "dashboard", displayName: "Dashboard", status: "active" },
  });

  await prisma.queryRegistry.upsert({
    where: { queryKey: "dashboard_today_summary" },
    update: { sourceType: "business", configJson: { handler: "dashboard_today_summary" } },
    create: {
      queryKey: "dashboard_today_summary",
      sourceType: "business",
      configJson: { handler: "dashboard_today_summary" },
    },
  });

  const block = await prisma.blockRegistry.upsert({
    where: { blockKey: "dashboard-metrics" },
    update: {
      moduleKey: "dashboard",
      displayName: "Dashboard Metrics",
      configJson: { queryKey: "dashboard_today_summary" },
    },
    create: {
      blockKey: "dashboard-metrics",
      moduleKey: "dashboard",
      displayName: "Dashboard Metrics",
      configJson: { queryKey: "dashboard_today_summary" },
    },
  });

  await prisma.layoutSlot.upsert({
    where: { pageKey_slotKey: { pageKey: "dashboard", slotKey: "main" } },
    update: { sortOrder: 0, blockRegistryId: block.id },
    create: { pageKey: "dashboard", slotKey: "main", sortOrder: 0, blockRegistryId: block.id },
  });
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo-tenant" },
    update: { name: "Demo Tenant", status: "active" },
    create: { slug: "demo-tenant", name: "Demo Tenant", status: "active" },
  });

  const existingCompany = await prisma.company.findFirst({
    where: { tenantId: tenant.id, slug: "demo-company" },
  });
  const company = existingCompany
    ? await prisma.company.update({ where: { id: existingCompany.id }, data: { name: "Demo Company" } })
    : await prisma.company.create({ data: { tenantId: tenant.id, slug: "demo-company", name: "Demo Company" } });

  // company_id is assigned directly here as a known, explicit fact — never left null for the
  // scope backfill classifier to guess at.
  const project = await prisma.project.upsert({
    where: { slug: "demo-project" },
    update: {
      name: "베를로",
      description: "Local demo project for SANGFOR Partner OS verification.",
      companyId: company.id,
    },
    create: {
      slug: "demo-project",
      name: "베를로",
      description: "Local demo project for SANGFOR Partner OS verification.",
      companyId: company.id,
    },
  });

  // U014/SEC-01: the seed is one of the only two paths allowed to write status="active" (the
  // other being an explicitly reviewed provisioning path), and it must do so explicitly, never by
  // relying on the column's own DEFAULT (which is "legacy_pending", i.e. inactive).
  const operator = await prisma.user.upsert({
    where: { email: "operator@sangfor-os.local" },
    update: { name: "포털 운영자", status: "active", disabledAt: null, disabledReason: null },
    create: {
      email: "operator@sangfor-os.local",
      name: "포털 운영자",
      status: "active",
    },
  });

  // U015/SEC-02a: the seed writes status="active" explicitly (never relying on the column's own
  // "legacy_pending" DEFAULT), same rule as User.status above, and uses one of the ten
  // @sangfor/auth BusinessRole codes now that UserCompanyRole.role is constrained to them for any
  // row created after the migration watermark.
  await prisma.userCompanyRole.upsert({
    where: { userId_companyId_role: { userId: operator.id, companyId: company.id, role: "system_admin" } },
    update: { status: "active", validFrom: new Date(), revokedAt: null },
    create: { userId: operator.id, companyId: company.id, role: "system_admin", status: "active", validFrom: new Date() },
  });

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: operator.id } },
    update: { status: "active", validFrom: new Date(), revokedAt: null },
    create: { projectId: project.id, userId: operator.id, role: "member", status: "active", validFrom: new Date() },
  });

  await upsertPolicyMemory(project.id, "internal_domain", "blro.co.kr", "BLRO internal domain");
  await upsertPolicyMemory(project.id, "system_sender_domain", "bill36524.com", "Bill36524 system sender");

  await seedDashboardRegistry();

  await prisma.supportSlaPolicy.upsert({
    where: { id: "sla-support-default" },
    update: { companyId: company.id },
    create: {
      id: "sla-support-default",
      companyId: company.id,
      name: "기본 영업지원 SLA",
      responseTimeHrs: 24,
      resolutionTimeHrs: 48,
      severity: "normal",
    },
  });

  // 자율운영 불변식: 초기 정책은 반드시 전부 observe — 자동화 0에서 시작
  await seedAutopilotPolicies(prisma.autonomyPolicy);

  console.log(`Seeded ${project.slug} (${project.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
