import { prisma } from '@sangfor/db';
import { parseSecureMailHtml } from './hometax-securemail';
import { getCompanyBusinessNumber } from './company-settings.service';
import { LedgerService } from './ledger.service';

export interface InboundResult {
  status: 'created' | 'duplicate' | 'skipped_not_ours' | 'failed';
  taxInvoiceId?: string;
  reason?: string;
}

export async function ingestSecureMailHtml(
  html: string,
  sourceMessageId?: string,
): Promise<InboundResult> {
  let biz: string;
  try {
    biz = await getCompanyBusinessNumber();
  } catch (e) {
    return { status: 'failed', reason: (e as Error).message };
  }

  let n;
  try {
    n = parseSecureMailHtml(html, biz);
  } catch (e) {
    return { status: 'failed', reason: `parse/decrypt failed: ${(e as Error).message}` };
  }

  if (n.buyerCorpNum.replace(/[^0-9]/g, '') !== biz) {
    return { status: 'skipped_not_ours', reason: `buyer ${n.buyerCorpNum} != company ${biz}` };
  }

  const existing = await prisma.taxInvoice.findUnique({ where: { issueId: n.issueId } });
  if (existing) return { status: 'duplicate', taxInvoiceId: existing.id };

  // Create expense and tax invoice in a transaction, then post ledger entries.
  let expenseId: string;
  let taxInvoiceId: string;

  await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        expenseName: n.itemSummary || n.supplierName,
        amount: n.supplyAmount,
        vat: n.vatAmount,
        total: n.totalAmount,
        category: '기타',
        vendor: n.supplierName,
        date: n.issueDate,
        proofType: '세금계산서',
        isPaid: false,
        memo: `자동수집 세금계산서 승인번호 ${n.issueId}`,
      },
    });

    const ti = await tx.taxInvoice.create({
      data: {
        direction: 'purchase',
        status: 'received',
        issueId: n.issueId,
        supplierCorpNum: n.supplierCorpNum,
        supplierName: n.supplierName,
        supplierCeoName: n.supplierCeoName,
        buyerCorpNum: n.buyerCorpNum,
        buyerName: n.buyerName,
        buyerCeoName: n.buyerCeoName,
        supplyAmount: n.supplyAmount,
        vatAmount: n.vatAmount,
        totalAmount: n.totalAmount,
        issueDate: n.issueDate,
        itemSummary: n.itemSummary,
        sourceMessageId,
        expenseId: expense.id,
        rawXml: n.rawXml,
      },
    });

    expenseId = expense.id;
    taxInvoiceId = ti.id;
  });

  // Post ledger entries using LedgerService (Deviation A: reuse existing postExpense).
  await new LedgerService().postExpense(expenseId!);

  return { status: 'created', taxInvoiceId: taxInvoiceId! };
}
