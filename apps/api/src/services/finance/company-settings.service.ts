import { prisma } from '@sangfor/db';

export async function getCompanyBusinessNumber(): Promise<string> {
  const s = await prisma.companySettings.findUnique({ where: { id: 'default' } });
  if (!s?.businessNumber) throw new Error('회사 사업자등록번호가 설정되지 않았습니다 (CFO 설정에서 등록)');
  return s.businessNumber.replace(/[^0-9]/g, '');
}

export async function setCompanySettings(input: {
  businessNumber: string;
  companyName?: string;
  ceoName?: string;
}) {
  const businessNumber = input.businessNumber.replace(/[^0-9]/g, '');
  return prisma.companySettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', businessNumber, companyName: input.companyName, ceoName: input.ceoName },
    update: { businessNumber, companyName: input.companyName, ceoName: input.ceoName },
  });
}
