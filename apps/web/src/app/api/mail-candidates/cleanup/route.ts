import { prisma } from "@sangfor/db";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    // 1. 같은 발신자의 고객 후보 중복 제거
    const customers = await prisma.mailDerivedCandidate.findMany({
      where: { candidateType: 'customer', status: 'proposed' },
      orderBy: { confidence: 'desc' },
    });

    const seenSenders = new Set<string>();
    let duplicatesRemoved = 0;

    for (const customer of customers) {
      const sender = customer.sourceSender?.toLowerCase() || '';
      if (seenSenders.has(sender)) {
        await prisma.mailDerivedCandidate.update({
          where: { id: customer.id },
          data: { status: 'rejected', metadata: { ...customer.metadata as any, rejectionReason: 'duplicate' } },
        });
        duplicatesRemoved++;
      } else {
        seenSenders.add(sender);
      }
    }

    // 2. nexias.com 고객 후보를 파트너로 변경
    const nexiasCustomers = await prisma.mailDerivedCandidate.findMany({
      where: { 
        candidateType: 'customer', 
        sourceSender: { contains: 'nexias.com' },
        status: 'proposed'
      },
    });

    let nexiasFixed = 0;
    for (const candidate of nexiasCustomers) {
      await prisma.mailDerivedCandidate.update({
        where: { id: candidate.id },
        data: { 
          candidateType: 'partner',
          title: candidate.title.replace('Customer:', 'Partner:'),
          metadata: { ...candidate.metadata as any, fixedReason: 'nexias_is_partner' }
        },
      });
      nexiasFixed++;
    }

    return NextResponse.json({
      success: true,
      duplicatesRemoved,
      nexiasFixed,
      message: `중복 제거: ${duplicatesRemoved}개, Nexias 수정: ${nexiasFixed}개`,
    });
  } catch (error) {
    return apiError("cleanup_failed", error, { status: 400 });
  }
}
