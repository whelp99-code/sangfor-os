import { prisma } from "@ai-portal/db";
import { NextResponse } from "next/server";

// Default project ID for entities
const DEFAULT_PROJECT_ID = "cmq2jhoxd00019kwe5k5p7tsw";

// 발신자 도메인에서 회사명 추출
function extractCompanyFromDomain(domain: string): string {
  const domainMap: Record<string, string> = {
    'berlo.co.kr': '베를로',
    'berlo.com': '베를로',
    'nexias.com': '넥시아스',
    'partner.co.kr': '파트너사',
    'customer.kr': '고객사',
    'sangfor.com': 'Sangfor',
  };
  return domainMap[domain] || domain.split('.')[0];
}

// 발신자명에서 담당자 추출
function extractContactFromEmail(email: string, name?: string): string {
  if (name) return name;
  const localPart = email.split('@')[0];
  return localPart.replace(/[0-9]/g, '').replace('.', ' ');
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
    // 1. Approved 고객 후보를 customers 테이블로 변환
    const approvedCustomers = await prisma.mailDerivedCandidate.findMany({
      where: { candidateType: "customer", status: "approved" },
    });

    let customersCreated = 0;
    for (const candidate of approvedCustomers) {
      const customerName = candidate.title.replace("Customer: ", "");
      const sourceEmail = candidate.sourceSender || '';
      const domain = sourceEmail.split('@')[1] || '';
      const contactName = extractContactFromEmail(sourceEmail);

      const existing = await prisma.customer.findFirst({
        where: { name: customerName, projectId: DEFAULT_PROJECT_ID },
      });

      if (!existing) {
        await prisma.customer.create({
          data: {
            projectId: DEFAULT_PROJECT_ID,
            name: extractCompanyFromDomain(domain) || customerName,
            domain: domain || (candidate.metadata as any)?.domain || null,
            industry: inferIndustry(candidate.summary),
            status: "active",
            notes: `담당자: ${contactName} | 원본: ${candidate.sourceTitle || ''}`,
          },
        });
        customersCreated++;
      }

      // 후보 상태를 converted로 변경
      await prisma.mailDerivedCandidate.update({
        where: { id: candidate.id },
        data: { status: "converted" },
      });
    }

    // 2. Approved 파트너 후보를 partners 테이블로 변환
    const approvedPartners = await prisma.mailDerivedCandidate.findMany({
      where: { candidateType: "partner", status: "approved" },
    });

    let partnersCreated = 0;
    for (const candidate of approvedPartners) {
      const partnerName = candidate.title.replace("Partner: ", "");
      const sourceEmail = candidate.sourceSender || '';
      const domain = sourceEmail.split('@')[1] || '';

      const existing = await prisma.partner.findFirst({
        where: { name: partnerName, projectId: DEFAULT_PROJECT_ID },
      });

      if (!existing) {
        await prisma.partner.create({
          data: {
            projectId: DEFAULT_PROJECT_ID,
            name: extractCompanyFromDomain(domain) || partnerName,
            partnerType: (candidate.metadata as any)?.partnerType || null,
            status: "active",
          },
        });
        partnersCreated++;
      }

      await prisma.mailDerivedCandidate.update({
        where: { id: candidate.id },
        data: { status: "converted" },
      });
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
            stage: "lead",
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
      opportunitiesCreated,
      tasksCreated,
      message: `고객: ${customersCreated}개, 파트너: ${partnersCreated}개, 기회: ${opportunitiesCreated}개, 작업: ${tasksCreated}개 생성 완료`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "convert_failed" },
      { status: 400 }
    );
  }
}
