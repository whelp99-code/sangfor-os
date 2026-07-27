import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { prisma } from "@sangfor/db";

const locations = [
  "서울", "부산", "인천", "대구", "대전", "광주", "울산", "수원", "창원", "고양",
];
const themes = [
  { key: "quantum", label: "양자보안", kind: "customer", phrase: "제품 도입을 위한 회사 정보 등록 요청" },
  { key: "channel", label: "채널유통", kind: "partner", phrase: "리셀러 파트너 계약 및 공동 영업 협업 제안" },
  { key: "license", label: "라이선스", kind: "opportunity", phrase: "라이선스 500석 구매 견적과 납기 요청" },
  { key: "poc", label: "PoC검증", kind: "poc", phrase: "보안 솔루션 PoC 테스트 일정과 검증 기준 요청" },
  { key: "followup", label: "후속조치", kind: "task", phrase: "기술 질의 회신과 다음 회의 일정 확인 요청" },
];

const projectId = process.env.DEFAULT_PROJECT_ID;
const output = process.env.REAL_USE_MAIL_MANIFEST;
if (!projectId || !output) throw new Error("DEFAULT_PROJECT_ID and REAL_USE_MAIL_MANIFEST are required");

const account = await prisma.mailAccount.create({
  data: {
    projectId,
    provider: "outlook",
    email: "real-use-100@sangfor.example.test",
    status: "connected",
    tenantId: "real-use-100-tenant",
    accessToken: "task-owned-synthetic-token",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    tokenScope: "Mail.Read User.Read",
  },
});

const records = Array.from({ length: 50 }, (_, index) => {
  const sequence = index + 1;
  const location = locations[index % locations.length];
  const theme = themes[Math.floor(index / locations.length)];
  const company = `REALMAIL-${String(sequence).padStart(3, "0")} ${location} ${theme.label} 주식회사`;
  const domain = `realmail-${String(sequence).padStart(3, "0")}-${theme.key}.example.test`;
  const subject = `[${company}] ${theme.phrase}`;
  const fromEmail = `buyer${sequence}@${domain}`;
  return {
    sequence,
    channel: "email",
    kind: theme.kind,
    company,
    domain,
    subject,
    fromEmail,
    conversationId: `real-use-mail-conversation-${String(sequence).padStart(3, "0")}`,
  };
});

await prisma.mailMessage.createMany({
  data: records.map((record) => ({
    accountId: account.id,
    subject: record.subject,
    fromEmail: record.fromEmail,
    toEmail: account.email,
    bodyPreview: `${record.company} 담당자입니다. ${record.subject}. 예산, 일정, 담당자를 포함해 회신 바랍니다.`,
    body: `${record.company}의 실제 운영 검증용 가상 메일입니다. ${record.subject}. 요청번호 ${record.sequence}.`,
    bodyFormat: "text",
    externalId: `real-use-mail-${String(record.sequence).padStart(3, "0")}`,
    conversationId: record.conversationId,
    direction: "inbound",
    receivedAt: new Date(Date.UTC(2026, 6, 27, 0, record.sequence, 0)),
  })),
});

mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
await prisma.$disconnect();
process.stdout.write(`${JSON.stringify({ accountId: account.id, messages: records.length, output })}\n`);
