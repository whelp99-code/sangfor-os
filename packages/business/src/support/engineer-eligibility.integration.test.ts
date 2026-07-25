import { describe, expect, it } from "vitest";
// @ts-ignore
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

describe("U053: engineer-eligibility integration tests", () => {
  it("evaluates eligibility against DB and assigns engineer atomically", async () => {
    if (!process.env.CI_INTEGRATION) {
      console.log("Skipping DB integration test because CI_INTEGRATION is not set");
      return;
    }

    const RUN_ID = `u053it-${Date.now().toString(36)}`;
    const EVIDENCE_DIR = `${process.cwd()}/.omo/evidence/sangfor-system-refactor-2026-07-15/U053/attempt-1/postgres-integration`;

    await withIsolatedPostgres(
      {
        runId: RUN_ID,
        ownerUnit: "U053",
        purpose: "engineer-eligibility-integration",
        evidenceDir: EVIDENCE_DIR,
        migrate: true,
      },
      async (ctx: { databaseUrl: string }) => {
        process.env.DATABASE_URL = ctx.databaseUrl;
        const { prisma } = await import("@sangfor/db");

        // Seed member
        const member = await prisma.userCompanyRole.create({
          data: { id: "ucr-u053-eng", companyId: "u053-company", userId: "u053-eng", role: "engineer", status: "active", validFrom: new Date(Date.now() - 3600000) },
        });

        const verifier = await prisma.userCompanyRole.create({
          data: { id: "ucr-u053-ver", companyId: "u053-company", userId: "u053-ver", role: "sales_manager", status: "active", validFrom: new Date(Date.now() - 3600000) },
        });

        const customer = await prisma.customer.create({
          data: { id: "cust-u053-1", projectId: "u053-project", name: "U053 Customer" },
        });

        const opp = await prisma.opportunity.create({
          data: { id: "u053-opp1", projectId: "u053-project", title: "U053 Opp", stage: "PROPOSAL" },
        });

        const engagement = await prisma.engagement.create({
          data: { id: "eng-u053-1", projectId: "u053-project", customerId: customer.id, opportunityId: opp.id, name: "U053 Engagement", status: "active" },
        });

        const req = await prisma.engagementCapabilityRequirement.create({
          data: {
            id: "req-u053-1", engagementId: engagement.id, productFamilyId: "fw", capabilityKey: "install", minimumSkillLevel: 1, headcount: 1,
          },
        });

        const certDef = await prisma.certificationDefinition.create({
          data: { id: "cdef-u053-fw", companyId: "u053-company", key: "k-fw", vendorKey: "v-fw", name: "FW Specialist", issuer: "Sangfor", productFamilyId: "fw", status: "active" },
        });

        const cert = await prisma.engineerCertification.create({
          data: { id: "cert-u053-1", engineerId: "u053-eng", productName: "FW", engineerMembershipId: member.id, definitionId: certDef.id, status: "active", revision: 1, issuedAt: new Date() },
        });

        const artifact = await prisma.artifact.create({
          data: {
            id: "art-u053-1", tenantId: "u053-tenant", companyId: "u053-company", projectId: "u053-project",
            artifactType: "proposal", classification: "internal", origin: "user", title: "U053 Proposal",
            createdByAssignmentId: verifier.id, ownerAssignmentId: verifier.id,
          },
        });

        const artVer = await prisma.artifactVersion.create({
          data: {
            id: "av-u053-1", artifactId: artifact.id, version: 1, contentHashVersion: "v1",
            canonicalContentEnvelope: "{}", contentHash: "hash-u053-av1", contentJson: {},
            status: "published", createdByAssignmentId: verifier.id,
          },
        });

        await prisma.certificationEvidence.create({
          data: { id: "ev-u053-1", certificationId: cert.id, artifactVersionId: artVer.id, issuer: "Sangfor", verifiedAt: new Date(), verifiedByAssignmentId: verifier.id },
        });

        await prisma.engineerSkill.create({
          data: { companyId: "u053-company", engineerMembershipId: member.id, productFamilyId: "fw", capabilityKey: "install", level: 3, status: "active", verifiedAt: new Date() },
        });

        const eligibilityService = await import("./engineer-eligibility");

        const AUTH_CTX: any = {
          userId: verifier.id, sessionId: "s1", tenantId: "u053-tenant", companyId: "u053-company", projectId: "u053-project",
          businessRole: "sales_manager", permissions: [], product: "portal",
        };

        const evalRes = await eligibilityService.evaluateEngineerEligibility({
          authContext: AUTH_CTX,
          engineerMembershipId: member.id,
          productFamilyId: "fw",
          capabilityKey: "install",
          now: new Date(),
        });

        expect(evalRes.eligible).toBe(true);

        const assignment = await eligibilityService.assignEngineerToEngagement({
          authContext: AUTH_CTX,
          engagementId: engagement.id,
          requirementId: req.id,
          engineerMembershipId: member.id,
          expectedRequirementSnapshotHash: "hash1",
          idempotencyKey: "k-assign-u053-1",
          now: new Date(),
        });

        expect(assignment.id).toBeDefined();
        expect(assignment.status).toBe("active");
      },
    );
  }, 180000);
});
