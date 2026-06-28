import { prisma } from '@sangfor/db';

export class CodefService {
  readonly enabled: boolean;

  constructor() {
    this.enabled = Boolean(process.env.CODEF_CLIENT_ID && process.env.CODEF_CLIENT_SECRET);
    if (!this.enabled) {
      console.warn('CODEF API 키 미설정 → 모의(mock) 연동 모드');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async connectAccount(input: { type: 'bank' | 'card'; organization: string; accountName: string; accountNum?: string; memo?: string }) {
    const connectedId = this.enabled ? null : `MOCK_CID_${Date.now()}`;
    return prisma.financeAccount.create({
      data: {
        type: input.type, organization: input.organization, accountName: input.accountName,
        accountNum: input.accountNum, connectedId, memo: input.memo,
        lastSyncedAt: this.enabled ? new Date() : null,
      },
    });
  }

  async listAccounts(type?: 'bank' | 'card') {
    return prisma.financeAccount.findMany({
      where: { isActive: true, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async syncTransactions(accountId: string, fromDate: Date, toDate: Date) {
    const account = await prisma.financeAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('계좌 없음');
    if (!this.enabled) {
      console.log(`mock sync for ${account.accountName}`);
      return { ok: true, mock: true, count: 0, message: 'CODEF 미설정, mock 응답' };
    }
    return { ok: true, mock: false, count: 0, message: 'CODEF SDK 호출 코드를 추가하세요' };
  }

  async getExpiringSoon(days = 7) {
    return prisma.financeAccount.findMany({
      where: {
        isActive: true,
        lastSyncedAt: { lte: new Date(Date.now() - 1000 * 60 * 60 * 24 * (30 - days)) },
      },
    });
  }
}
