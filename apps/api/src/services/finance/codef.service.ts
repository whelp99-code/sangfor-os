import { prisma } from '@sangfor/db';

export const EXTERNAL_FINANCE_MUTATION_CONTAINMENT_CODE = 'EXTERNAL_MUTATION_CONTAINED' as const;

export type ExternalFinanceMutationOperation =
  | 'codef.connect_account'
  | 'codef.sync_transactions'
  | 'popbill.issue'
  | 'popbill.collect_purchase';

export class ExternalFinanceMutationContainmentError extends Error {
  readonly code = EXTERNAL_FINANCE_MUTATION_CONTAINMENT_CODE;
  readonly operation: ExternalFinanceMutationOperation;

  constructor(operation: ExternalFinanceMutationOperation) {
    super(EXTERNAL_FINANCE_MUTATION_CONTAINMENT_CODE);
    this.name = 'ExternalFinanceMutationContainmentError';
    this.operation = operation;
  }
}

export function denyExternalFinanceMutation(operation: ExternalFinanceMutationOperation): never {
  throw new ExternalFinanceMutationContainmentError(operation);
}

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

  async connectAccount(_input: { type: 'bank' | 'card'; organization: string; accountName: string; accountNum?: string; memo?: string }) {
    denyExternalFinanceMutation('codef.connect_account');
  }

  async listAccounts(type?: 'bank' | 'card') {
    return prisma.financeAccount.findMany({
      where: { isActive: true, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async syncTransactions(_accountId: string, _fromDate: Date, _toDate: Date) {
    denyExternalFinanceMutation('codef.sync_transactions');
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
