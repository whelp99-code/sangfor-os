import { prisma } from "@ai-portal/db";
import { NextResponse } from "next/server";

// 실제 메일 데이터 생성 함수
async function generateRealisticMailData(count: number) {
  // 기존 MailAccount 조회 또는 생성
  let account = await prisma.mailAccount.findFirst();
  if (!account) {
    const project = await prisma.project.findFirst();
    account = await prisma.mailAccount.create({
      data: {
        projectId: project?.id ?? "default",
        provider: "outlook",
        email: "import@demo.mail",
        status: "mock",
      },
    });
  }

  const companies = [
    { domain: 'berlo.co.kr', name: '베를로', industry: 'IT/소프트웨어' },
    { domain: 'nexias.com', name: '넥시아스', industry: 'IT/서비스' },
    { domain: 'partner.co.kr', name: '파트너사', industry: 'IT/유통' },
    { domain: 'customer.kr', name: '고객사', industry: '제조' },
    { domain: 'sangfor.com', name: 'Sangfor', industry: '보안/네트워크' },
  ];

  const contacts = [
    { name: '김철수', position: '과장' },
    { name: '이영희', position: '부장' },
    { name: '박지민', position: '팀장' },
    { name: '최동욱', position: '대리' },
    { name: '정수연', position: '사원' },
  ];

  const subjects = [
    '제품 구매 문의',
    '기술 지원 요청',
    '파트너십 제안',
    '계약 갱신 논의',
    '가격 문의',
    '납기 일정 확인',
    '장애 대응 요청',
    '회의 일정 조율',
    '교육 프로그램 문의',
    '견적서 요청',
  ];

  const messages = [];
  for (let i = 0; i < count; i++) {
    const company = companies[i % companies.length];
    const contact = contacts[i % contacts.length];
    const subject = subjects[i % subjects.length];

    messages.push({
      accountId: account.id,
      subject: `${company.name} ${subject} - ${contact.name} ${contact.position}`,
      fromEmail: `${contact.name.toLowerCase().replace(/\s/g, '.')}@${company.domain}`,
      bodyPreview: `안녕하세요. ${company.name} ${contact.name} ${contact.position}입니다. ${subject}에 대해 문의드립니다.`,
      groupKey: company.domain.split('.')[0],
    });
  }
  return messages;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const count = Math.min(Number(body.count ?? 100), 2000);

    // 실제 메일 데이터 생성
    const sampleMessages = await generateRealisticMailData(count);

    // DB에 삽입
    const result = await prisma.mailMessage.createMany({
      data: sampleMessages,
      skipDuplicates: true,
    });

    return NextResponse.json({
      success: true,
      imported: result.count,
      total: count,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "import_failed" },
      { status: 400 }
    );
  }
}

export async function GET() {
  try {
    const count = await prisma.mailMessage.count();
    return NextResponse.json({ count });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "count_failed" },
      { status: 400 }
    );
  }
}
