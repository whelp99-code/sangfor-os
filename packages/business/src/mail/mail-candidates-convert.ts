import { prisma } from "@sangfor/db";
import { deriveEntityFromCandidate, canonicalCompanyKey } from "./mail-entity-quality";
import { resolveDefaultProjectId } from "../infrastructure/default-project";

export interface ConvertResult {
  customersCreated: number;
  partnersCreated: number;
  customersSkipped: number;
  partnersSkipped: number;
  customersMerged: number;
  partnersMerged: number;
  opportunitiesCreated: number;
  tasksCreated: number;
}

async function resolveProjectId(): Promise<string> {
  return resolveDefaultProjectId(prisma);
}

// 업종 추론
function inferIndustry(summary?: string | null): string {
  if (!summary) return "IT";
  const text = summary.toLowerCase();
  if (text.includes("보안") || text.includes("security") || text.includes("네트워크")) return "보안/네트워크";
  if (text.includes("소프트웨어") || text.includes("software") || text.includes("개발")) return "IT/소프트웨어";
  if (text.includes("서비스") || text.includes("service")) return "IT/서비스";
  if (text.includes("유통") || text.includes("distribution")) return "IT/유통";
  if (text.includes("제조") || text.includes("manufacturing")) return "제조";
  return "IT";
}

/**
 * Convert approved mail-derived candidates (customer/partner/opportunity/task)
 * into their real entity tables.
 * Extracted from apps/web route to decouple presentation from persistence.
 */
export async function convertApprovedMailCandidates(): Promise<ConvertResult> {
  const DEFAULT_PROJECT_ID = await resolveProjectId();

  // 1. Approved 고객 후보를 customers 테이블로 변환
  const approvedCustomers = await prisma.mailDerivedCandidate.findMany({
    where: { candidateType: "customer", status: "approved" },
  });

  // Pre-load existing customer canonical keys to prevent cross-domain duplicates
  const existingCustomerRows = await prisma.customer.findMany({ where: { projectId: DEFAULT_PROJECT_ID }, select: { name: true } });
  const seenCustomerKeys = new Set(existingCustomerRows.map((r) => canonicalCompanyKey(r.name)));

  let customersCreated = 0;
  let customersSkipped = 0;
  let customersMerged = 0;
  for (const candidate of approvedCustomers) {
    const e = deriveEntityFromCandidate(candidate);
    if (e.skip) {
      await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: "rejected" } });
      customersSkipped++;
      continue;
    }
    const key = canonicalCompanyKey(e.name);
    if (seenCustomerKeys.has(key)) {
      // Maps to an existing entity by canonical name — mark converted, don't duplicate
      await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: "converted" } });
      customersMerged++;
      continue;
    }
    const existing = await prisma.customer.findFirst({ where: { domain: e.domain, projectId: DEFAULT_PROJECT_ID } });
    if (!existing) {
      await prisma.customer.create({
        data: {
          projectId: DEFAULT_PROJECT_ID,
          name: e.name,
          domain: e.domain,
          industry: inferIndustry(candidate.summary),
          status: "active",
          notes: `원본: ${candidate.sourceTitle || ""}`,
        },
      });
      customersCreated++;
    }
    seenCustomerKeys.add(key);
    await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: "converted" } });
  }

  // 2. Approved 파트너 후보를 partners 테이블로 변환
  const approvedPartners = await prisma.mailDerivedCandidate.findMany({
    where: { candidateType: "partner", status: "approved" },
  });

  // Pre-load existing partner canonical keys to prevent cross-domain duplicates
  const existingPartnerRows = await prisma.partner.findMany({ where: { projectId: DEFAULT_PROJECT_ID }, select: { name: true } });
  const seenPartnerKeys = new Set(existingPartnerRows.map((r) => canonicalCompanyKey(r.name)));

  let partnersCreated = 0;
  let partnersSkipped = 0;
  let partnersMerged = 0;
  for (const candidate of approvedPartners) {
    const e = deriveEntityFromCandidate(candidate);
    if (e.skip) {
      await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: "rejected" } });
      partnersSkipped++;
      continue;
    }
    const key = canonicalCompanyKey(e.name);
    if (seenPartnerKeys.has(key)) {
      // Maps to an existing entity by canonical name — mark converted, don't duplicate
      await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: "converted" } });
      partnersMerged++;
      continue;
    }
    const existing = await prisma.partner.findFirst({ where: { name: e.name, projectId: DEFAULT_PROJECT_ID } });
    if (!existing) {
      await prisma.partner.create({
        data: {
          projectId: DEFAULT_PROJECT_ID,
          name: e.name,
          partnerType: (candidate.metadata as any)?.partnerType || null,
          status: "active",
        },
      });
      partnersCreated++;
    }
    seenPartnerKeys.add(key);
    await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: "converted" } });
  }

  // 3. Approved opportunity 후보를 opportunities 테이블로 변환
  const approvedOpportunities = await prisma.mailDerivedCandidate.findMany({
    where: { candidateType: "opportunity", status: "approved" },
  });

  let opportunitiesCreated = 0;
  for (const candidate of approvedOpportunities) {
    // Strip "Opportunity: " prefix (parity with per-record approve path)
    const title = candidate.title.replace(/^Opportunity:\s*/i, "");

    const existing = await prisma.opportunity.findFirst({
      where: { title, projectId: DEFAULT_PROJECT_ID },
    });

    if (!existing) {
      const created = await prisma.opportunity.create({
        data: {
          projectId: DEFAULT_PROJECT_ID,
          title,
          stage: "LEAD",
          probability: 20,
          nextAction: candidate.summary || null,
        },
      });
      opportunitiesCreated++;

      await prisma.mailDerivedCandidate.update({
        where: { id: candidate.id },
        data: { status: "converted", createdEntityType: "opportunity", createdEntityId: created.id },
      });
    } else {
      await prisma.mailDerivedCandidate.update({
        where: { id: candidate.id },
        data: { status: "converted", createdEntityType: "opportunity", createdEntityId: existing.id },
      });
    }
  }

  // 4. Approved task 후보를 work_tasks 테이블로 변환
  const approvedTasks = await prisma.mailDerivedCandidate.findMany({
    where: { candidateType: "task", status: "approved" },
  });

  let tasksCreated = 0;
  for (const candidate of approvedTasks) {
    const existing = await prisma.workTask.findFirst({
      where: { title: candidate.title, projectId: DEFAULT_PROJECT_ID },
    });

    let taskId = existing?.id;
    if (!existing) {
      const created = await prisma.workTask.create({
        data: {
          projectId: DEFAULT_PROJECT_ID,
          title: candidate.title,
          status: "todo",
          priority: "normal",
          source: "mail-intelligence",
        },
      });
      taskId = created.id;
      tasksCreated++;
    }

    await prisma.mailDerivedCandidate.update({
      where: { id: candidate.id },
      data: { status: "converted", createdEntityType: "task", createdEntityId: taskId },
    });
  }

  return {
    customersCreated,
    partnersCreated,
    customersSkipped,
    partnersSkipped,
    customersMerged,
    partnersMerged,
    opportunitiesCreated,
    tasksCreated,
  };
}
