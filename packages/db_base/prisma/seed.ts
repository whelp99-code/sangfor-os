import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import { seedRegistry } from "./seed-registry";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const prisma = new PrismaClient();
const seedDemoData = process.env.AIOS_SEED_DEMO_DATA === "1";

/**
 * Purpose:
 * - Seed Phase 1 sample data: command_run → workflow → step → agent → tool → validation → report.
 * - Writes audit.state_transition_logs and audit.outbox_events for the sample run.
 */
async function main() {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: "operator@ai-portal.local" },
      update: {},
      create: {
        email: "operator@ai-portal.local",
        name: "Portal Operator",
      },
    });

    const project = await tx.project.upsert({
      where: { slug: "demo-project" },
      update: {
        name: "Mail Intelligence Operations",
        description: "Operational project rebuilt from Mail Intelligence ingestion.",
      },
      create: {
        slug: "demo-project",
        name: "Mail Intelligence Operations",
        description: "Operational project rebuilt from Mail Intelligence ingestion.",
      },
    });

    await tx.projectMember.upsert({
      where: {
        projectId_userId: { projectId: project.id, userId: user.id },
      },
      update: {},
      create: {
        projectId: project.id,
        userId: user.id,
        role: "owner",
      },
    });

    if (!seedDemoData) {
      return;
    }

    const command = await tx.command.upsert({
      where: { key: "bootstrap-feature" },
      update: {},
      create: {
        key: "bootstrap-feature",
        title: "Bootstrap feature request",
        description: "Sample command for DB kernel validation",
      },
    });

    const existingRun = await tx.commandRun.findFirst({
      where: { commandId: command.id, projectId: project.id },
      include: {
        workflows: {
          include: {
            steps: {
              include: {
                agentAssignments: { include: { toolCalls: true } },
                validationResults: { include: { reports: true } },
              },
            },
          },
        },
      },
    });

    if (existingRun?.workflows.length) {
      console.log("Seed already applied:", existingRun.id);
      return;
    }

    const commandRun = await tx.commandRun.create({
      data: {
        commandId: command.id,
        projectId: project.id,
        requestedById: user.id,
        status: "running",
        inputSummary: "Validate DB kernel execution chain",
      },
    });

    await tx.stateTransitionLog.create({
      data: {
        entityType: "command_run",
        entityId: commandRun.id,
        fromStatus: "pending",
        toStatus: "running",
        actorType: "user",
        actorId: user.id,
        metadata: { source: "seed" },
      },
    });

    await tx.outboxEvent.create({
      data: {
        eventType: "command_run.started",
        aggregateType: "command_run",
        aggregateId: commandRun.id,
        payload: { commandKey: command.key, projectSlug: project.slug },
        status: "pending",
      },
    });

    const workflow = await tx.workflow.create({
      data: {
        commandRunId: commandRun.id,
        status: "running",
      },
    });

    const step = await tx.workflowStep.create({
      data: {
        workflowId: workflow.id,
        stepKey: "implement-and-verify",
        status: "completed",
        sortOrder: 1,
      },
    });

    const assignment = await tx.agentAssignment.create({
      data: {
        workflowStepId: step.id,
        agentKey: "cursor-main",
        status: "completed",
      },
    });

    await tx.toolCall.create({
      data: {
        agentAssignmentId: assignment.id,
        toolKey: "run_checks",
        status: "succeeded",
      },
    });

    const validation = await tx.validationResult.create({
      data: {
        workflowStepId: step.id,
        checkKey: "lint-test-build",
        status: "passed",
        detailsJson: { lint: true, test: true, build: true },
      },
    });

    await tx.report.create({
      data: {
        validationResultId: validation.id,
        title: "Phase 1 seed validation report",
        bodyMarkdown: "Sample report linked to validation result.",
      },
    });

    console.log("Seeded command_run:", commandRun.id);
  });

  await seedRegistry(prisma);
  console.log("Registry seed complete");

  if (!seedDemoData) {
    console.log("Demo data seed skipped (set AIOS_SEED_DEMO_DATA=1 to enable).");
    return;
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { slug: "demo-project" },
  });
  const existingCustomers = await prisma.customer.count({
    where: { projectId: project.id },
  });
  if (existingCustomers === 0) {
    const customer = await prisma.customer.create({
      data: {
        projectId: project.id,
        name: "Acme Manufacturing",
        domain: "acme.example.com",
        industry: "Manufacturing",
      },
    });
    const partner = await prisma.partner.create({
      data: {
        projectId: project.id,
        name: "Sangfor Korea Partner",
        partnerType: "reseller",
      },
    });
    await prisma.customerPartnerLink.create({
      data: { customerId: customer.id, partnerId: partner.id },
    });
    await prisma.contact.create({
      data: {
        customerId: customer.id,
        name: "Kim Operator",
        email: "kim@acme.example.com",
        role: "IT Manager",
      },
    });
    await prisma.customerActivityLog.create({
      data: {
        customerId: customer.id,
        activityType: "created",
        summary: "Customer Acme Manufacturing created (seed)",
      },
    });
    const due = new Date();
    due.setHours(18, 0, 0, 0);
    await prisma.workTask.create({
      data: {
        projectId: project.id,
        title: "Follow up PoC scope with Acme",
        priority: "high",
        dueAt: due,
        customerId: customer.id,
        source: "seed",
      },
    });
    console.log("Customer/partner demo seeded");
  } else {
    console.log("Customer/partner demo already present:", existingCustomers);
  }

  const customer = await prisma.customer.findFirst({
    where: { projectId: project.id },
  });
  if (customer) {
    const pocCount = await prisma.pocProject.count({ where: { projectId: project.id } });
    if (pocCount === 0) {
      const poc = await prisma.pocProject.create({
        data: {
          projectId: project.id,
          customerId: customer.id,
          title: "Acme HCI PoC",
          productName: "Sangfor HCI",
          productLine: "aCloud",
          deploymentType: "2-node cluster",
          hwSpec: "2x Sangfor aServer 2200",
          swSpec: "aCloud 6.8",
          networkNotes: "10GbE management + storage VLAN",
          status: "in_progress",
          requirements: "Validate virtualization workload migration",
        },
      });
      await prisma.pocChecklistItem.createMany({
        data: [
          { pocProjectId: poc.id, label: "Scope confirmation", done: true, sortOrder: 1 },
          { pocProjectId: poc.id, label: "Hardware spec review", done: true, sortOrder: 2 },
          { pocProjectId: poc.id, label: "Environment setup", sortOrder: 3 },
        ],
      });
      await prisma.pocRequirement.create({
        data: {
          pocProjectId: poc.id,
          label: "Migrate 3 VMs",
          details: "Windows + Linux mixed workload",
          sortOrder: 1,
        },
      });
      await prisma.pocEvent.create({
        data: {
          pocProjectId: poc.id,
          eventType: "kickoff",
          summary: "PoC kickoff with customer IT team",
        },
      });
      console.log("PoC demo seeded");
    }

    const oppCount = await prisma.opportunity.count({ where: { projectId: project.id } });
    if (oppCount === 0) {
      const opp = await prisma.opportunity.create({
        data: {
          projectId: project.id,
          customerId: customer.id,
          title: "Acme platform rollout",
          stage: "qualified",
          probability: 40,
        },
      });
      await prisma.opportunityStageEvent.create({
        data: {
          opportunityId: opp.id,
          toStage: "qualified",
          note: "Seed",
        },
      });
      console.log("Opportunity demo seeded");
    }
  }

  const knowledgeCount = await prisma.knowledgeDocument.count({
    where: { projectId: project.id },
  });
  if (knowledgeCount === 0) {
    await prisma.knowledgeDocument.createMany({
      data: [
        {
          projectId: project.id,
          title: "Sangfor HCI Overview",
          body: "Hyper-converged infrastructure product line for enterprise virtualization.",
          tags: ["sangfor", "hci"],
        },
        {
          projectId: project.id,
          title: "PoC Success Criteria",
          body: "Define measurable outcomes before PoC kickoff.",
          tags: ["poc"],
        },
      ],
    });
    console.log("Knowledge demo seeded");
  }

  const template = await prisma.documentTemplate.upsert({
    where: {
      projectId_templateKey: { projectId: project.id, templateKey: "standard-proposal" },
    },
    update: {},
    create: {
      projectId: project.id,
      templateKey: "standard-proposal",
      title: "Standard Proposal",
      bodyMarkdown: "# Proposal for {{customer_name}}\n\n## Scope\n{{scope}}\n",
    },
  });
  const genCount = await prisma.generatedDocument.count({ where: { templateId: template.id } });
  if (genCount === 0 && customer) {
    await prisma.generatedDocument.create({
      data: {
        templateId: template.id,
        customerId: customer.id,
        title: "Acme initial proposal",
        bodyMarkdown: "# Proposal for Acme Manufacturing\n\n## Scope\nSangfor HCI PoC",
        status: "draft",
      },
    });
    console.log("Proposal demo seeded");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
