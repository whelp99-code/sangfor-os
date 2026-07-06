// 제안서 접지(grounding) 컨텍스트 빌더.
// 얇은 단일 메일 preview(255자) 대신 ①해당 딜의 전 메일을 시간순으로 집약하고
// ②KB(knowledge_chunks)에서 제품/레퍼런스 지식을 키워드로 붙여, 역할 AI가
// 실제 근거 위에서 문서를 쓰도록(컬러게이트 blue/orange/gray 렌즈 대응) 한다.
import { prisma } from '@sangfor/db';

const SANGFOR_KB_TERMS = ['Sangfor', 'HCI', 'NGAF', 'aStor', 'VM', '보안', 'security', '방화벽', '가상화'];

export interface GroundedContextInput {
  match: string; // 관련 메일 검색어(고객명/도메인 조각)
  customerName: string;
  baseNote?: string; // 기존 단일 메일 컨텍스트(있으면 앞에 붙임)
  maxMails?: number; // 기본 20
}

/** 스레드 집약(전 딜 메일 시간순) + 라이트 KB RAG(키워드 청크)로 접지 컨텍스트를 만든다. */
export async function buildGroundedContext(input: GroundedContextInput): Promise<string> {
  const mails = await prisma.mailMessage.findMany({
    where: {
      OR: [{ subject: { contains: input.match } }, { fromEmail: { contains: input.match } }],
    },
    orderBy: { receivedAt: 'asc' },
    take: input.maxMails ?? 20,
    select: { receivedAt: true, direction: true, subject: true, bodyPreview: true },
  });
  const timeline = mails
    .map((m) => {
      const day = m.receivedAt ? m.receivedAt.toISOString().slice(0, 10) : '';
      const dir = m.direction === 'outbound' ? '우리→' : '←상대';
      return `- [${day}] ${dir} ${m.subject ?? ''}: ${(m.bodyPreview ?? '').slice(0, 120)}`;
    })
    .join('\n');

  // KB 키워드: 메일 제목에 등장한 제품 용어 + 기본 Sangfor 용어(항상 포함).
  const subjectsBlob = mails.map((m) => m.subject ?? '').join(' ');
  const kw = SANGFOR_KB_TERMS.filter((t) => t === 'Sangfor' || subjectsBlob.includes(t));
  const chunks = kw.length
    ? await prisma.knowledgeChunk.findMany({
        where: { OR: kw.map((k) => ({ content: { contains: k } })) },
        take: 5,
        select: { content: true },
      })
    : [];
  const kb = chunks.map((c) => `- ${c.content.slice(0, 220)}`).join('\n');

  const base = input.baseNote ? `${input.baseNote}\n\n` : '';
  return `${base}## 이 딜의 메일 타임라인 (${mails.length}건, 시간순)
${timeline || '- (관련 메일 없음)'}

## 제품/레퍼런스 지식 (KB)
${kb || '- (매칭 지식 없음)'}`;
}
