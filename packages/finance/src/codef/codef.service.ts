import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CodefService {
  private readonly logger = new Logger(CodefService.name);
  private readonly enabled: boolean;

  constructor(@Inject('PRISMA') private readonly prisma: any) {
    this.enabled = Boolean(
      process.env.CODEF_CLIENT_ID && process.env.CODEF_CLIENT_SECRET,
    );
    if (!this.enabled) {
      this.logger.warn('CODEF API 키 미설정 → 모의(mock) 연동 모드');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * CODEF 계좌/카드 연동 등록
   * - 실제: OAuth 2.0 + connectedId 발급
   * - mock: connectedId를 시뮬레이션 값으로 저장
   */
  async connectAccount(input: {
    type: 'bank' | 'card';
    organization: string;
    accountName: string;
    accountNum?: string;
    memo?: string;
  }) {
    const connectedId = this.enabled ? null : `MOCK_CID_${Date.now()}`;
    return this.prisma.financeAccount.create({
      data: {
        type: input.type,
        organization: input.organization,
        accountName: input.accountName,
        accountNum: input.accountNum,
        connectedId,
        memo: input.memo,
        lastSyncedAt: this.enabled ? new Date() : null,
      },
    });
  }

  async listAccounts(type?: 'bank' | 'card') {
    return this.prisma.financeAccount.findMany({
      where: { isActive: true, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 거래내역 동기화 (수집 트리거)
   * - 실제: CODEF /v1/kr/card/a/list 또는 bank/tran/list 호출
   * - mock: 빈 결과 반환
   */
  async syncTransactions(accountId: string, fromDate: Date, toDate: Date) {
    const account = await this.prisma.financeAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new BadRequestException('계좌 없음');

    if (!this.enabled) {
      this.logger.log(`mock sync for ${account.accountName}`);
      return { ok: true, mock: true, count: 0, message: 'CODEF 미설정, mock 응답' };
    }

    // CODEF REST 호출 자리
    return { ok: true, mock: false, count: 0, message: 'CODEF SDK 호출 코드를 추가하세요' };
  }

  /**
   * 간편인증 만료 알림 대상
   */
  async getExpiringSoon(days = 7) {
    return this.prisma.financeAccount.findMany({
      where: {
        isActive: true,
        // lastSyncedAt + 만료 임박 계산
        lastSyncedAt: {
          lte: new Date(Date.now() - 1000 * 60 * 60 * 24 * (30 - days)),
        },
      },
    });
  }
}
