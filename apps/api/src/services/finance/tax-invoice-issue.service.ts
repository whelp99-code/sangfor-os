import { prisma } from '@sangfor/db';
import { getCompanyBusinessNumber } from './company-settings.service';
import { manualTransmitter, type NtsTransmitter } from './nts-transmit.adapter';

export interface IssueInput {
  buyerCorpNum: string; buyerName: string; buyerCeoName?: string;
  items: { name: string; amount: number }[];
}

export async function issueSalesTaxInvoice(
  input: IssueInput, transmitter: NtsTransmitter = manualTransmitter,
): Promise<{ id: string; status: string }> {
  const biz = await getCompanyBusinessNumber();
  const settings = await prisma.companySettings.findUnique({ where: { id: 'default' } });
  const supplyAmount = input.items.reduce((s, i) => s + i.amount, 0);
  const vatAmount = Math.round(supplyAmount * 0.1);
  const summary = input.items[0]?.name ?? '';
  const itemSummary = input.items.length > 1 ? `${summary} 외 ${input.items.length - 1}건` : summary;

  const ti = await prisma.taxInvoice.create({
    data: {
      direction: 'sales', status: 'draft',
      supplierCorpNum: biz, supplierName: settings?.companyName ?? '', supplierCeoName: settings?.ceoName,
      buyerCorpNum: input.buyerCorpNum.replace(/[^0-9]/g, ''), buyerName: input.buyerName, buyerCeoName: input.buyerCeoName,
      supplyAmount, vatAmount, totalAmount: supplyAmount + vatAmount,
      issueDate: new Date(), itemSummary,
    },
  });
  const t = await transmitter.transmit(ti.id);
  await prisma.taxInvoice.update({ where: { id: ti.id }, data: { status: t.status } });
  return { id: ti.id, status: t.status };
}

export async function markTransmitted(taxInvoiceId: string): Promise<void> {
  await prisma.taxInvoice.update({ where: { id: taxInvoiceId }, data: { status: 'transmitted' } });
}
