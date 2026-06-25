import { prisma } from "@ai-portal/db";
import { NextResponse } from "next/server";

/**
 * 주제별/대화별 스레드 그룹핑
 * - 제목 정규화 (Re:, Fwd: 등 제거)
 * - 발신자+수신자 조합 기반
 * - 시간 기반 (같은 대화는 24시간 이내)
 */
function groupMessagesIntoThreads(messages: Array<{
  id: string;
  subject: string;
  fromEmail: string;
  createdAt: Date;
  [key: string]: unknown;
}>) {
  const threads = new Map<string, typeof messages>();

  for (const msg of messages) {
    // 1. 제목 기반 그룹핑 (Re:_FWD: 제거 후 비교)
    const normalizedSubject = msg.subject
      .replace(/^(Re:|Fwd?:|FW:)\s*/gi, '')
      .trim()
      .toLowerCase();

    // 2. 발신자+수신자 조합 기반
    const participants = [msg.fromEmail].sort().join('|');

    // 3. 시간 기반 (같은 대화는 24시간 이내)
    const timeWindow = Math.floor(msg.createdAt.getTime() / (24 * 60 * 60 * 1000));

    const threadKey = `${normalizedSubject}:${participants}:${timeWindow}`;

    if (!threads.has(threadKey)) {
      threads.set(threadKey, []);
    }
    threads.get(threadKey)!.push(msg);
  }

  return threads;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit ?? 100), 2000);

    // 메일 메시지 조회
    const messages = await prisma.mailMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // 주제별/대화별 스레드 그룹핑
    const threadMap = groupMessagesIntoThreads(messages);

    let created = 0;
    for (const [threadKey, threadMessages] of threadMap) {
      // 참가자 도메인 추출
      const participantDomains = [...new Set(
        threadMessages.map(m => m.fromEmail.split('@')[1])
      )];

      // 스레드 제목: 가장 최근 메일의 정규화된 제목 사용
      const subject = threadMessages[0].subject
        .replace(/^(Re:|Fwd?:|FW:)\s*/gi, '')
        .trim();

      // 기존 스레드 확인
      const existing = await prisma.mailInsightThread.findFirst({
        where: { threadKey }
      });

      if (existing) {
        // 기존 스레드 업데이트
        await prisma.mailInsightThread.update({
          where: { id: existing.id },
          data: {
            messageCount: threadMessages.length,
            messageIds: threadMessages.map(m => m.id),
            latestReceivedAt: threadMessages[0].createdAt,
            participantDomains,
          }
        });
      } else {
        // 새 스레드 생성
        await prisma.mailInsightThread.create({
          data: {
            projectId: (await prisma.project.findFirst())?.id ?? '',
            threadKey,
            threadTitle: subject,
            sourceProvider: 'mail-import',
            accountEmail: threadMessages[0].fromEmail,
            messageCount: threadMessages.length,
            messageIds: threadMessages.map(m => m.id),
            latestReceivedAt: threadMessages[0].createdAt,
            status: 'reference',
            summary: `${subject} 관련 메일 스레드 (${threadMessages.length}건)`,
            participantDomains,
            revenueOpsTags: [],
          }
        });
        created++;
      }
    }

    return NextResponse.json({
      success: true,
      threadsCreated: created,
      totalMessages: messages.length,
      groupingMethod: 'subject+participants+timeWindow',
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "generate_failed" },
      { status: 400 }
    );
  }
}
