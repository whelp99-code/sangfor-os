import { prisma } from "@sangfor/db";
import { deriveEntityFromCandidate, canonicalCompanyKey } from "@sangfor/business";
import { NextResponse } from "next/server";

// Resolve the active portal project (slug "demo-project"; fall back to the
// first project). The previous hardcoded id was stale, so converted records
// landed under a non-existent project and never showed in the portal.
async function resolveProjectId(): Promise<string> {
  const bySlug = await prisma.project.findFirst({ where: { slug: "demo-project" }, select: { id: true } });
  if (bySlug) return bySlug.id;
  const first = await prisma.project.findFirst({ select: { id: true } });
  if (!first) throw new Error("no project found to attach entities to");
  return first.id;
}

// 업종 추론
function inferIndustry(summary?: string | null): string {
  if (!summary) return 'IT';
  const text = summary.toLowerCase();
  if (text.includes('보안') || text.includes('security') || text.includes('네트워크')) return '보안/네트워크';
  if (text.includes('소프트웨어') || text.includes('software') || text.includes('개발')) return 'IT/소프트웨어';
  if (text.includes('서비스') || text.includes('service')) return 'IT/서비스';
  if (text.includes('유통') || text.includes('distribution')) return 'IT/유통';
  if (text.includes('제조') || text.includes('manufacturing')) return '제조';
  return 'IT';
}

export async function POST() {
  try {
    const DEFAULT_PROJECT_ID = await resolveProjectId();

    // 1. Approved 고객 후보를 customers 테이블로 변환
    const approvedCustomers = await prisma.mailDerivedCandidate.findMany({
      where: { candidateType: "customer", status: "approved" },
    });

    // Pre-load existing customer canonical keys to prevent cross-domain duplicates
    const existingCustomerRows = await prisma.customer.findMany({ where: { projectId: DEFAULT_PROJECT_ID }, select: { name: true } });
    const seenCustomerKeys = new Set(existingCustomerRows.map(r => canonicalCompanyKey(r.name)));

    let customersCreated = 0;
    let customersSkipped = 0;
    let customersMerged = 0;
    for (const candidate of approvedCustomers) {
      const e = deriveEntityFromCandidate(candidate);
      if (e.skip) {
        await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: 'rejected' } });
        customersSkipped++;
        continue;
      }
      const key = canonicalCompanyKey(e.name);
      if (seenCustomerKeys.has(key)) {
        // Maps to an existing entity by canonical name — mark converted, don't duplicate
        await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: 'converted' } });
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
            notes: `원본: ${candidate.sourceTitle || ''}`,
          },
        });
        customersCreated++;
      }
      seenCustomerKeys.add(key);
      await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: 'converted' } });
    }

    // 2. Approved 파트너 후보를 partners 테이블로 변환
    const approvedPartners = await prisma.mailDerivedCandidate.findMany({
      where: { candidateType: "partner", status: "approved" },
    });

    // Pre-load existing partner canonical keys to prevent cross-domain duplicates
    const existingPartnerRows = await prisma.partner.findMany({ where: { projectId: DEFAULT_PROJECT_ID }, select: { name: true } });
    const seenPartnerKeys = new Set(existingPartnerRows.map(r => canonicalCompanyKey(r.name)));

    let partnersCreated = 0;
    let partnersSkipped = 0;
    let partnersMerged = 0;
    for (const candidate of approvedPartners) {
      const e = deriveEntityFromCandidate(candidate);
      if (e.skip) {
        await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: 'rejected' } });
        partnersSkipped++;
        continue;
      }
      const key = canonicalCompanyKey(e.name);
      if (seenPartnerKeys.has(key)) {
        // Maps to an existing entity by canonical name — mark converted, don't duplicate
        await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: 'converted' } });
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
      await prisma.mailDerivedCandidate.update({ where: { id: candidate.id }, data: { status: 'converted' } });
    }

    // 3. Approved opportunity 후보를 opportunities 테이블로 변환
    const approvedOpportunities = await prisma.mailDerivedCandidate.findMany({
      where: { candidateType: "opportunity", status: "approved" },
    });

    let opportunitiesCreated = 0;
    for (const candidate of approvedOpportunities) {
      const existing = await prisma.opportunity.findFirst({
        where: { title: candidate.title, projectId: DEFAULT_PROJECT_ID },
      });

      if (!existing) {
        await prisma.opportunity.create({
          data: {
            projectId: DEFAULT_PROJECT_ID,
            title: candidate.title,
            stage: "LEAD",
            probability: 20,
            nextAction: candidate.summary || null,
          },
        });
        opportunitiesCreated++;
      }

      await prisma.mailDerivedCandidate.update({
        where: { id: candidate.id },
        data: { status: "converted" },
      });
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

      if (!existing) {
        await prisma.workTask.create({
          data: {
            projectId: DEFAULT_PROJECT_ID,
            title: candidate.title,
            status: "todo",
            priority: "normal",
            source: "mail-intelligence",
          },
        });
        tasksCreated++;
      }

      await prisma.mailDerivedCandidate.update({
        where: { id: candidate.id },
        data: { status: "converted" },
      });
    }

    return NextResponse.json({
      success: true,
      customersCreated,
      partnersCreated,
      customersSkipped,
      partnersSkipped,
      customersMerged,
      partnersMerged,
      opportunitiesCreated,
      tasksCreated,
      message: `고객: ${customersCreated}개 생성, ${customersMerged}개 병합, ${customersSkipped}개 제외 | 파트너: ${partnersCreated}개 생성, ${partnersMerged}개 병합, ${partnersSkipped}개 제외 | 기회: ${opportunitiesCreated}개 | 작업: ${tasksCreated}개`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "convert_failed" },
      { status: 400 }
    );
  }
}
