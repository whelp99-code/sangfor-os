import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { prisma } from "@sangfor/db";
import { parseCanonicalArtifactContent } from "@sangfor/db";
import {
  activateWorkflowDefinition,
  createArtifactVersion,
  createWorkflowDefinition,
  decideApproval,
  submitApprovalRequest,
  type ApprovalKernelCaller,
} from "@sangfor/business";
import { BUSINESS_ROLE_CODES } from "@sangfor/auth";
import { QUOTE_HTTP_OPPORTUNITY_COUNT } from "./contracts";

export const DEFAULT_CORPUS = Object.freeze({
  customers: 100,
  opportunities: 1_000,
  artifactVersions: 10_000,
  workflows: 1,
});

const scope = {
  tenantId: "u075-tenant",
  companyId: "u075-company",
  projectId: "u075-project",
};
const operatorId = "u075-operator";
const operatorAssignmentId = "u075-operator-role";
const approverId = "u075-approver";
const approverAssignmentId = "u075-approver-role";

function caller(userId = operatorId, sessionId = "u075-seed-session"): ApprovalKernelCaller {
  return { userId, sessionId, scope, mfaVerifiedAt: new Date() };
}

function timestamp(index: number): Date {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, index));
}

async function seedScope(): Promise<void> {
  await prisma.tenant.create({ data: { id: scope.tenantId, slug: "u075-tenant", name: "U075 Tenant", status: "active" } });
  await prisma.company.create({ data: { id: scope.companyId, tenantId: scope.tenantId, slug: "u075-company", name: "U075 Company" } });
  await prisma.project.create({ data: { id: scope.projectId, companyId: scope.companyId, slug: "demo-project", name: "U075 Performance Project" } });
  const roleUsers = BUSINESS_ROLE_CODES.map((role) => ({
    role,
    userId: role === "system_admin" ? operatorId : role === "security_officer" ? approverId : `u075-user-${role}`,
    assignmentId: role === "system_admin" ? operatorAssignmentId : role === "security_officer" ? approverAssignmentId : `u075-role-${role}`,
  }));
  await prisma.user.createMany({ data: roleUsers.map(({ role, userId }) => ({
    id: userId,
    email: role === "system_admin" ? "operator@sangfor-os.local" : `${role.replaceAll("_", "-")}@u075.test`,
    name: `U075 ${role}`,
    status: "active",
  })) });
  await prisma.userCompanyRole.createMany({ data: roleUsers.map(({ role, userId, assignmentId }) => ({
    id: assignmentId,
    userId,
    companyId: scope.companyId,
    role,
    status: "active",
    validFrom: timestamp(0),
  })) });
  await prisma.projectMember.createMany({ data: roleUsers.map(({ role, userId }) => ({
    id: `u075-member-${role}`,
    projectId: scope.projectId,
    userId,
    role: "member",
    status: "active",
    validFrom: timestamp(0),
  })) });

  await prisma.tenant.create({ data: { id: "u075-foreign-tenant", slug: "u075-foreign-tenant", name: "Foreign Tenant", status: "active" } });
  await prisma.company.create({ data: { id: "u075-foreign-company", tenantId: "u075-foreign-tenant", slug: "u075-foreign-company", name: "Foreign Company" } });
  await prisma.project.create({ data: { id: "u075-foreign-project", companyId: "u075-foreign-company", slug: "u075-foreign-project", name: "Foreign Project" } });
}

async function seedCatalogAndQuote(): Promise<void> {
  await prisma.productFamily.create({
    data: {
      id: "u075-product-family",
      companyId: scope.companyId,
      familyKey: "U075_FAMILY",
      vendorKey: "SANGFOR",
      vendor: "SANGFOR",
      name: "U075 Performance Family",
      category: "SECURITY",
      status: "active",
      createdAt: timestamp(0),
      updatedAt: timestamp(0),
    },
  });
  await prisma.productEdition.create({
    data: {
      id: "u075-product-edition",
      familyId: "u075-product-family",
      editionKey: "enterprise",
      name: "Enterprise",
      version: "2026.1",
      status: "active",
      createdAt: timestamp(0),
      updatedAt: timestamp(0),
    },
  });
  await prisma.productSku.create({
    data: {
      id: "u075-product-sku",
      editionId: "u075-product-edition",
      skuCode: "U075-SKU-001",
      name: "U075 Performance SKU",
      unitPrice: 10_000,
      unitCost: 6_000,
      currency: "KRW",
      status: "active",
      createdAt: timestamp(0),
      updatedAt: timestamp(0),
    },
  });
  await prisma.quote.create({
    data: {
      id: "u075-canonical-quote",
      opportunityId: "u075-opportunity-0000",
      companyId: scope.companyId,
      status: "draft",
      totalRevenue: 10_000,
      totalCost: 6_000,
      marginPct: 40,
      createdBy: operatorId,
      currency: "KRW",
      lineItems: {
        create: {
          id: "u075-canonical-quote-line",
          skuId: "u075-product-sku",
          quantity: 1,
          unitPrice: 10_000,
          costPrice: 6_000,
          revenue: 10_000,
          cost: 6_000,
          marginPct: 40,
          currency: "KRW",
        },
      },
    },
  });
}

async function seedCrm(): Promise<void> {
  await prisma.customer.createMany({ data: [
    ...Array.from({ length: DEFAULT_CORPUS.customers }, (_, index) => ({
      id: `u075-customer-${String(index).padStart(3, "0")}`,
      projectId: scope.projectId,
      name: `U075 Customer ${String(index).padStart(3, "0")}`,
      domain: `customer-${index}.u075.test`,
      status: "active",
      createdAt: timestamp(index),
      updatedAt: timestamp(index),
    })),
    { id: "u075-customer-archived", projectId: scope.projectId, name: "Archived Sentinel", status: "archived", archivedAt: timestamp(0), createdAt: timestamp(0), updatedAt: timestamp(0) },
    { id: "u075-customer-foreign", projectId: "u075-foreign-project", name: "Foreign Sentinel", status: "active", createdAt: timestamp(0), updatedAt: timestamp(0) },
  ] });

  await prisma.opportunity.createMany({ data: [
    ...Array.from({ length: DEFAULT_CORPUS.opportunities }, (_, index) => ({
      id: `u075-opportunity-${String(index).padStart(4, "0")}`,
      projectId: scope.projectId,
      customerId: `u075-customer-${String(index % DEFAULT_CORPUS.customers).padStart(3, "0")}`,
      title: `U075 Opportunity ${String(index).padStart(4, "0")}`,
      code: `U075-${String(index).padStart(4, "0")}`,
      stage: "QUALIFIED" as const,
      dealStatus: "OPEN" as const,
      amount: 100_000 + index,
      probability: 40,
      createdAt: timestamp(index),
      updatedAt: timestamp(index),
    })),
    { id: "u075-opportunity-archived", projectId: scope.projectId, customerId: "u075-customer-000", title: "Archived Opportunity Sentinel", code: "U075-ARCHIVED", stage: "LOST", dealStatus: "LOST", archivedAt: timestamp(0), createdAt: timestamp(0), updatedAt: timestamp(0) },
    { id: "u075-opportunity-foreign", projectId: "u075-foreign-project", customerId: "u075-customer-foreign", title: "Foreign Opportunity Sentinel", code: "U075-FOREIGN", stage: "QUALIFIED", dealStatus: "OPEN", createdAt: timestamp(0), updatedAt: timestamp(0) },
  ] });

  await prisma.dealQualification.createMany({
    data: Array.from({ length: QUOTE_HTTP_OPPORTUNITY_COUNT + 1 }, (_, index) => ({
      id: `u075-qualification-${String(index).padStart(4, "0")}`,
      opportunityId: `u075-opportunity-${String(index).padStart(4, "0")}`,
      budgetScore: 20,
      authorityScore: 20,
      needScore: 24,
      timelineScore: 16,
      technicalFitScore: 20,
      weightedScore: 100,
      scoreTotal: 100,
      passed: true,
      scoringVersion: "bant-tf-v1",
      revision: 1,
      qualifiedBy: "u075-user-ceo",
      assessedByAssignmentId: "u075-role-ceo",
      qualifiedAt: timestamp(index),
      assessedAt: timestamp(index),
      updatedAt: timestamp(index),
    })),
  });
}

async function seedArtifactVersions(): Promise<void> {
  await prisma.artifact.create({
    data: {
      id: "u075-corpus-artifact",
      ...scope,
      artifactType: "performance-corpus",
      classification: "internal",
      origin: "ai",
      title: "U075 Deterministic Artifact Corpus",
      createdByAssignmentId: operatorAssignmentId,
      ownerAssignmentId: operatorAssignmentId,
    },
  });

  for (let start = 0; start < DEFAULT_CORPUS.artifactVersions; start += 500) {
    const data = Array.from({ length: Math.min(500, DEFAULT_CORPUS.artifactVersions - start) }, (_, offset) => {
      const index = start + offset;
      const canonical = parseCanonicalArtifactContent(`{"index":${index},"kind":"u075-performance"}`);
      return {
        id: `u075-artifact-version-${String(index).padStart(5, "0")}`,
        artifactId: "u075-corpus-artifact",
        version: index + 1,
        contentHashVersion: canonical.contentHashVersion,
        canonicalContentEnvelope: canonical.canonicalContentEnvelope,
        contentHash: canonical.contentHash,
        contentJson: canonical.contentJson as object,
        sanitizedText: `U075 artifact ${index}`,
        status: "human_draft",
        createdByAssignmentId: operatorAssignmentId,
        createdAt: timestamp(index),
      };
    });
    await prisma.artifactVersion.createMany({ data });
  }
}

async function seedWorkflow(): Promise<string> {
  await prisma.artifact.create({
    data: {
      id: "u075-workflow-artifact",
      ...scope,
      artifactType: "workflow-definition",
      classification: "internal",
      origin: "ai",
      title: "U075 Side-effect-free Workflow",
      createdByAssignmentId: operatorAssignmentId,
      ownerAssignmentId: operatorAssignmentId,
    },
  });
  const version = await createArtifactVersion({
    artifactId: "u075-workflow-artifact",
    expectedCurrentVersionId: null,
    expectedCurrentRevision: 0,
    content: '{"runApprovalRequired":false,"steps":[{"key":"measure"}]}',
    contentType: "application/json",
  }, caller());
  const definition = await createWorkflowDefinition({
    workflowKey: "u075-performance",
    name: "U075 Performance Workflow",
    definitionArtifactVersionId: version.versionId,
  }, caller());
  const approval = await submitApprovalRequest({
    action: "workflow.activate",
    artifactVersionId: version.versionId,
    artifactHash: version.contentHash,
    policyVersion: "v1",
    requiredQuorum: 1,
  }, caller());
  const decided = await decideApproval({
    approvalId: approval.request.id,
    decision: "approve",
    expectedRevision: approval.request.revision,
  }, caller(approverId, "u075-approver-session"));
  const active = await activateWorkflowDefinition({
    workflowDefinitionId: definition.id,
    expectedRevision: definition.revision,
    approvalId: decided.request.id,
  }, caller(approverId, "u075-approver-session"));
  return active.id;
}

async function verifyCorpus(workflowDefinitionId: string) {
  const [customers, opportunities, artifactVersions, workflows, archivedCustomers, foreignCustomers, canonicalRoles, productSkus, quotes] = await Promise.all([
    prisma.customer.count({ where: { projectId: scope.projectId, archivedAt: null } }),
    prisma.opportunity.count({ where: { projectId: scope.projectId, archivedAt: null } }),
    prisma.artifactVersion.count({ where: { artifactId: "u075-corpus-artifact" } }),
    prisma.workflowDefinition.count({ where: { id: workflowDefinitionId, status: "active" } }),
    prisma.customer.count({ where: { id: "u075-customer-archived", archivedAt: { not: null } } }),
    prisma.customer.count({ where: { id: "u075-customer-foreign", projectId: "u075-foreign-project" } }),
    prisma.userCompanyRole.count({ where: { companyId: scope.companyId, status: "active", role: { in: [...BUSINESS_ROLE_CODES] } } }),
    prisma.productSku.count({ where: { id: "u075-product-sku", status: "active" } }),
    prisma.quote.count({ where: { id: "u075-canonical-quote", opportunityId: "u075-opportunity-0000" } }),
  ]);
  const actual = { customers, opportunities, artifactVersions, workflows };
  if (JSON.stringify(actual) !== JSON.stringify(DEFAULT_CORPUS) || archivedCustomers !== 1 || foreignCustomers !== 1 || canonicalRoles !== BUSINESS_ROLE_CODES.length || productSkus !== 1 || quotes !== 1) {
    throw new Error(`corpus verification failed: ${JSON.stringify({ actual, archivedCustomers, foreignCustomers, canonicalRoles, productSkus, quotes })}`);
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope,
    operatorId,
    operatorAssignmentId,
    workflowRunnerId: approverId,
    workflowDefinitionId,
    quoteOpportunityId: "u075-opportunity-0000",
    counts: actual,
    ordering: ["updatedAt:desc", "id:desc"],
    defaultPageSize: 50,
    maxPageSize: 100,
    sentinels: { archivedCustomerId: "u075-customer-archived", foreignCustomerId: "u075-customer-foreign" },
    catalogQuoteSet: { productSkuId: "u075-product-sku", quoteId: "u075-canonical-quote" },
    canonicalRoleCount: canonicalRoles,
  };
}

async function main() {
  const receiptPath = process.env.PERF_CORPUS_RECEIPT_FILE;
  if (!receiptPath) throw new Error("PERF_CORPUS_RECEIPT_FILE is required");
  await seedScope();
  await seedCrm();
  await seedCatalogAndQuote();
  await seedArtifactVersions();
  const workflowDefinitionId = await seedWorkflow();
  const receipt = await verifyCorpus(workflowDefinitionId);
  writeFileSync(resolve(receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }).finally(() => prisma.$disconnect());
}
