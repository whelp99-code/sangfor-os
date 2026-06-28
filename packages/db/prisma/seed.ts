import { prisma } from "../src/index";

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
  const project = await prisma.project.upsert({
    where: { slug: "demo-project" },
    update: {
      name: "Demo Project",
      description: "Local demo project for SANGFOR Partner OS verification.",
    },
    create: {
      slug: "demo-project",
      name: "Demo Project",
      description: "Local demo project for SANGFOR Partner OS verification.",
    },
  });

  await prisma.user.upsert({
    where: { email: "operator@sangfor-os.local" },
    update: { name: "Portal Operator" },
    create: {
      email: "operator@sangfor-os.local",
      name: "Portal Operator",
    },
  });

  await upsertPolicyMemory(project.id, "internal_domain", "blro.co.kr", "BLRO internal domain");
  await upsertPolicyMemory(project.id, "system_sender_domain", "bill36524.com", "Bill36524 system sender");

  await seedDashboardRegistry();

  const existingCustomer = await prisma.customer.findFirst({
    where: { projectId: project.id, domain: "demo-customer.example.com" },
  });
  const customer = existingCustomer
    ? await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: {
          name: "Demo Customer",
          status: "active",
          notes: "Synthetic W1-W2 demo customer. No private data.",
        },
      })
    : await prisma.customer.create({
        data: {
          projectId: project.id,
          name: "Demo Customer",
          domain: "demo-customer.example.com",
          status: "active",
          notes: "Synthetic W1-W2 demo customer. No private data.",
        },
      });

  const existingContact = await prisma.contact.findFirst({
    where: { customerId: customer.id, email: "buyer@demo-customer.example.com" },
  });
  if (existingContact) {
    await prisma.contact.update({
      where: { id: existingContact.id },
      data: { name: "Demo Buyer", role: "Business buyer" },
    });
  } else {
    await prisma.contact.create({
      data: {
        customerId: customer.id,
        name: "Demo Buyer",
        email: "buyer@demo-customer.example.com",
        role: "Business buyer",
      },
    });
  }

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
