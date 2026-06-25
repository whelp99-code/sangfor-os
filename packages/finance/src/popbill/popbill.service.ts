import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

export interface IssueTaxInvoiceInput {
  invoiceId?: string;
  projectId?: string;
  direction: 'sales' | 'purchase';
  supplierCorpNum: string;
  supplierName: string;
  supplierCEOName?: string;
  supplierAddr?: string;
  supplierBizType?: string;
  supplierBizClass?: string;
  buyerCorpNum: string;
  buyerName: string;
  buyerCEOName?: string;
  buyerAddr?: string;
  buyerBizType?: string;
  buyerBizClass?: string;
  buyerEmail?: string;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  issueDate: Date;
  memo?: string;
  items: {
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
  }[];
  mgtKey?: string;
}

/**
 * 팝빌 SDK 래퍼 (콜백 → Promise)
 * SDK가 콜백 기반이므로 직접 래핑
 */
function promisify<T = any>(fn: any, ...boundArgs: any[]) {
  return (...args: any[]) =>
    new Promise<T>((resolve, reject) => {
      const success = (res: T) => resolve(res);
      const error = (err: any) => reject(err);
      try {
        fn(...boundArgs, ...args, success, error);
      } catch (e) {
        reject(e);
      }
    });
}

@Injectable()
export class PopbillService {
  private readonly logger = new Logger(PopbillService.name);
  private readonly enabled: boolean;
  private popbill: any | null = null;

  constructor(@Inject('PRISMA') private readonly prisma: any) {
    const linkId = process.env.POPBILL_LINK_ID;
    const secretKey = process.env.POPBILL_SECRET_KEY;
    this.enabled = Boolean(linkId && secretKey);
    if (this.enabled) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        this.popbill = require('popbill');
        this.popbill.config({
          LinkID: linkId,
          SecretKey: secretKey,
          IsTest: process.env.POPBILL_IS_TEST === 'true',
          defaultErrorHandler: (e: any) => this.logger.error(`팝빌 에러: ${e?.message ?? e}`),
        });
        this.logger.log(`팝빌 연동 활성화 (테스트모드=${process.env.POPBILL_IS_TEST === 'true'})`);
      } catch (e: any) {
        this.logger.warn(`팝빌 SDK 로드 실패: ${e?.message ?? e}`);
        this.popbill = null;
      }
    } else {
      this.logger.warn('팝빌 API 키 미설정 → 모의(mock) 발행 모드');
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.popbill !== null;
  }

  /**
   * 팝빌 회원 사업자번호 (환경변수)
   */
  private getCorpNum(): string {
    const num = process.env.POPBILL_CORP_NUM ?? '';
    if (!num) {
      throw new BadRequestException('POPBILL_CORP_NUM 환경변수가 설정되지 않았습니다.');
    }
    return num.replace(/-/g, '');
  }

  /**
   * 팝빌 연결 상태 확인 (잔여 크레딧 등)
   */
  async checkStatus() {
    if (!this.isEnabled()) return { enabled: false, message: '팝빌 API 키 미설정' };
    try {
      const tax = this.popbill!.TaxinvoiceService();
      const getChargeInfo = promisify<any>(tax.getChargeInfo);
      const chargeInfo = await getChargeInfo(this.getCorpNum());
      return {
        enabled: true,
        testMode: process.env.POPBILL_IS_TEST === 'true',
        chargeInfo,
      };
    } catch (e: any) {
      this.logger.error(`팝빌 상태 확인 실패: ${e?.message ?? e}`);
      return { enabled: true, error: e?.message ?? String(e) };
    }
  }

  /**
   * 세금계산서 발행
   * - 팝빌 환경변수가 있으면 실제 SDK 호출
   * - 없으면 mock 응답을 DB에 저장 (개발용)
   */
  async issue(input: IssueTaxInvoiceInput) {
    if (input.supplyAmount + input.vatAmount !== input.totalAmount) {
      throw new BadRequestException('공급가액+세액 = 합계가 일치해야 합니다.');
    }
    if (input.items.length === 0) {
      throw new BadRequestException('품목이 최소 1개 이상 필요합니다.');
    }

    // 1) DB에 우선 저장
    const mgtKey = input.mgtKey ?? `INV-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const record = await this.prisma.taxInvoice.create({
      data: {
        invoiceId: input.invoiceId,
        projectId: input.projectId,
        direction: input.direction,
        status: this.isEnabled() ? 'requested' : 'draft',
        supplierCorpNum: input.supplierCorpNum,
        supplierName: input.supplierName,
        buyerCorpNum: input.buyerCorpNum,
        buyerName: input.buyerName,
        supplyAmount: input.supplyAmount,
        vatAmount: input.vatAmount,
        totalAmount: input.totalAmount,
        issueDate: input.issueDate,
        memo: input.memo,
        rawResponse: JSON.stringify({ mgtKey, source: 'cfo-aios' }),
      },
    });

    if (!this.isEnabled()) {
      // 모의 발행
      this.logger.log(`[MOCK] 세금계산서 발행: ${record.id} mgtKey=${mgtKey}`);
      return { ok: true, mock: true, taxInvoice: record, mgtKey };
    }

    // 2) 팝빌 실제 발행
    try {
      const tax = this.popbill!.TaxinvoiceService();
      const register = promisify<any>(tax.register);

      const issueDate = this.toPopbillDate(input.issueDate);
      const corpNum = this.getCorpNum();
      const taxInvoice = {
        writeDate: issueDate,
        chargeDirection: '정과금',
        purposeType: '영수',
        supplyCostTotal: String(input.supplyAmount),
        taxTotal: String(input.vatAmount),
        totalAmount: String(input.totalAmount),
        remark1: input.memo ?? '',
        invoicerCorpNum: input.supplierCorpNum.replace(/-/g, ''),
        invoicerCorpName: input.supplierName,
        invoicerCEOName: input.supplierCEOName ?? '',
        invoicerAddr: input.supplierAddr ?? '',
        invoicerBizType: input.supplierBizType ?? '',
        invoicerBizClass: input.supplierBizClass ?? '',
        invoiceeCorpNum: input.buyerCorpNum.replace(/-/g, ''),
        invoiceeCorpName: input.buyerName,
        invoiceeCEOName: input.buyerCEOName ?? '',
        invoiceeAddr: input.buyerAddr ?? '',
        invoiceeBizType: input.buyerBizType ?? '',
        invoiceeBizClass: input.buyerBizClass ?? '',
        invoiceeEmail1: input.buyerEmail ?? '',
        detailList: input.items.map((it, i) => ({
          serialNum: String(i + 1),
          itemName: it.name,
          qty: String(it.qty),
          unitCost: String(it.unitPrice),
          amount: String(it.amount),
          tax: '과세',
        })),
      };

      await register(corpNum, taxInvoice, '', false);

      // 3) 국세청 전송 (즉시 발행)
      const send = promisify<any>(tax.send);
      await send(corpNum, 'SELL', mgtKey, '');

      // 4) DB 업데이트
      const updated = await this.prisma.taxInvoice.update({
        where: { id: record.id },
        data: {
          status: 'transmitted',
          rawResponse: JSON.stringify({ mgtKey, sdkResult: 'success' }),
        },
      });

      return { ok: true, mock: false, taxInvoice: updated, mgtKey };
    } catch (e: any) {
      this.logger.error(`팝빌 발행 실패: ${e?.message ?? e}`);
      await this.prisma.taxInvoice.update({
        where: { id: record.id },
        data: {
          status: 'failed',
          rawResponse: JSON.stringify({ mgtKey, error: e?.message ?? String(e) }),
        },
      });
      return { ok: false, mock: false, error: e?.message ?? String(e), taxInvoice: record };
    }
  }

  /**
   * 매입 세금계산서 조회 (홈택스)
   */
  async collectPurchaseTaxInvoices(year: number, month: number) {
    if (!this.isEnabled()) {
      return { ok: true, mock: true, count: 0, message: '팝빌 미설정, mock 응답' };
    }
    try {
      const ht = this.popbill!.HTTaxinvoiceService();
      const getChargeInfo = promisify<any>(ht.getChargeInfo);
      const charge = await getChargeInfo(this.getCorpNum());
      return { ok: true, mock: false, chargeInfo: charge };
    } catch (e: any) {
      this.logger.error(`홈택스 조회 실패: ${e?.message ?? e}`);
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  /**
   * 사업자등록상태 조회
   */
  async checkBizInfo(corpNum: string) {
    if (!this.isEnabled()) {
      return {
        ok: true,
        mock: true,
        corpNum,
        status: '정상',
        message: '팝빌 미설정, mock 정상 응답',
      };
    }
    try {
      const svc = this.popbill!.BizInfoCheckService();
      const checkBiz = promisify<any>(svc.checkBizInfo);
      const result = await checkBiz(this.getCorpNum(), corpNum.replace(/-/g, ''));
      return { ok: true, mock: false, corpNum, ...result };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e), corpNum };
    }
  }

  async listHistory(opts: { direction?: string; status?: string; limit?: number } = {}) {
    return this.prisma.taxInvoice.findMany({
      where: {
        direction: opts.direction,
        status: opts.status,
      },
      orderBy: { issueDate: 'desc' },
      take: opts.limit ?? 50,
    });
  }

  private toPopbillDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }
}
