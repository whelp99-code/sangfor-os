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
