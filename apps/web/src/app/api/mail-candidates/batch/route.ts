import { prisma } from "@ai-portal/db";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, minConfidence = 85 } = body;

    if (action === 'approve') {
      // 신뢰도 85% 이상 후보 승인
      const result = await prisma.mailDerivedCandidate.updateMany({
        where: {
          status: 'proposed',
          confidence: { gte: minConfidence },
        },
        data: { status: 'approved' },
      });

      return NextResponse.json({
        success: true,
        action: 'approve',
        count: result.count,
        message: `${result.count}개 후보 승인 완료`,
      });
    }

    if (action === 'reject') {
      // 중복/잘못된 후보 거부
      const result = await prisma.mailDerivedCandidate.updateMany({
        where: {
          status: 'proposed',
          OR: [
            { sourceSender: { contains: 'nexias.com' }, candidateType: 'customer' },
            { sourceSender: { contains: 'berlo.com' }, candidateType: 'customer' },
          ],
        },
        data: { 
          status: 'rejected',
          metadata: { rejectionReason: 'incorrect_classification' }
        },
      });

      return NextResponse.json({
        success: true,
        action: 'reject',
        count: result.count,
        message: `${result.count}개 후보 거부 완료`,
      });
    }

    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "batch_failed" },
      { status: 400 }
    );
  }
}
