// 도메인 AI 제안을 통합 문서 저장소(GeneratedDocument)로 승격한다.
// 지금까지 도메인 제안은 DomainDecisionLog.outputJson 에만 갇혀 있어 통합 저장소
// (/proposals, 프로젝트 허브 산출물)에 나타나지 않았다. 사람이 승인하면 이 함수가
// GeneratedDocument + DocumentVersion(v1) 을 만들어 engagement/opportunity/customer 에
// 연결한다. GeneratedDocument.templateId 는 필수라 프로젝트별 generic 템플릿을 ensure 한다.
import { prisma } from "@sangfor/db";

const DOMAIN_AI_TEMPLATE_KEY = "domain-ai";

export interface PromoteInput {
  engagementId: string;
  domain: string;
  title: string;
  bodyMarkdown: string;
  status?: string; // 기본 approved
}

/**
 * 승격 결과. engagement→opportunity→project 체인이 없으면(예: 테스트용 가짜 id)
 * null 을 반환하고 아무것도 만들지 않는다(비파괴적).
 */
export async function promoteDomainProposalToDocument(
  input: PromoteInput,
): Promise<{ documentId: string } | null> {
  const eng = await prisma.engagement.findUnique({
    where: { id: input.engagementId },
    select: {
      id: true,
      customerId: true,
      opportunity: { select: { id: true, projectId: true, customerId: true } },
    },
  });
  if (!eng) return null;

  const projectId = eng.opportunity?.projectId ?? null;
  if (!projectId) return null;

  const customerId = eng.customerId ?? eng.opportunity?.customerId ?? null;
  const opportunityId = eng.opportunity?.id ?? null;

  // 프로젝트별 generic 도메인 AI 템플릿 ensure (본문은 산출물로 대체되므로 placeholder)
  const template = await prisma.documentTemplate.upsert({
    where: {
      projectId_templateKey: { projectId, templateKey: DOMAIN_AI_TEMPLATE_KEY },
    },
    update: {},
    create: {
      projectId,
      templateKey: DOMAIN_AI_TEMPLATE_KEY,
      title: "도메인 AI 산출물",
      bodyMarkdown: "{{body}}",
    },
  });

  const doc = await prisma.generatedDocument.create({
    data: {
      templateId: template.id,
      customerId,
      opportunityId,
      engagementId: eng.id,
      title: input.title,
      bodyMarkdown: input.bodyMarkdown,
      status: input.status ?? "approved",
    },
  });

  await prisma.documentVersion.create({
    data: {
      generatedDocumentId: doc.id,
      version: 1,
      bodyMarkdown: input.bodyMarkdown,
    },
  });

  return { documentId: doc.id };
}
