export interface NormalizedLineItem { name: string; amount: number; tax: number; quantity: number; }
export interface NormalizedTaxInvoice {
  issueId: string;
  issueDate: Date;
  typeCode: string;
  supplierCorpNum: string;
  supplierName: string;
  supplierCeoName: string;
  supplierEmail: string | null;
  buyerCorpNum: string;
  buyerName: string;
  buyerCeoName: string;
  buyerEmail: string | null;
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  items: NormalizedLineItem[];
  itemSummary: string;
  rawXml: string;
}

const tag = (src: string, name: string): string => {
  const m = src.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
};
const block = (src: string, name: string): string => tag(src, name);
const num = (s: string): number => parseInt(s.replace(/[^0-9-]/g, ''), 10) || 0;

const parseIssueDate = (s: string): Date => {
  // YYYYMMDDHHmmss 또는 YYYYMMDD — NTS timestamps are KST (+09:00)
  const y = s.slice(0, 4), mo = s.slice(4, 6), d = s.slice(6, 8);
  const h = s.slice(8, 10) || '00', mi = s.slice(10, 12) || '00', se = s.slice(12, 14) || '00';
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}+09:00`);
};

export function parseTaxInvoiceXml(xml: string): NormalizedTaxInvoice {
  const doc = block(xml, 'TaxInvoiceDocument');
  const settle = block(xml, 'TaxInvoiceTradeSettlement');
  const invoicer = block(settle, 'InvoicerParty');
  const invoicee = block(settle, 'InvoiceeParty');
  const sums = block(settle, 'SpecifiedMonetarySummation');

  const partyEmail = (p: string): string | null => {
    const c = block(p, 'DefinedContact') || block(p, 'PrimaryDefinedContact');
    const v = tag(c, 'URICommunication');
    return v || null;
  };

  const items: NormalizedLineItem[] = [];
  const itemRe = /<TaxInvoiceTradeLineItem>([\s\S]*?)<\/TaxInvoiceTradeLineItem>/g;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(xml))) {
    const it = im[1];
    items.push({
      name: tag(it, 'NameText'),
      amount: num(tag(it, 'InvoiceAmount')),
      tax: num(tag(block(it, 'TotalTax'), 'CalculatedAmount')),
      quantity: num(tag(it, 'ChargeableUnitQuantity')),
    });
  }

  const firstName = items[0]?.name ?? '';
  const itemSummary = items.length > 1 ? `${firstName} 외 ${items.length - 1}건` : firstName;

  return {
    issueId: tag(doc, 'IssueID'),
    issueDate: parseIssueDate(tag(block(xml, 'ExchangedDocument'), 'IssueDateTime')),
    typeCode: tag(doc, 'TypeCode'),
    supplierCorpNum: tag(invoicer, 'ID'),
    supplierName: tag(invoicer, 'NameText'),
    supplierCeoName: tag(block(invoicer, 'SpecifiedPerson'), 'NameText'),
    supplierEmail: partyEmail(invoicer),
    buyerCorpNum: tag(invoicee, 'ID'),
    buyerName: tag(invoicee, 'NameText'),
    buyerCeoName: tag(block(invoicee, 'SpecifiedPerson'), 'NameText'),
    buyerEmail: partyEmail(invoicee),
    supplyAmount: num(tag(sums, 'ChargeTotalAmount')),
    vatAmount: num(tag(sums, 'TaxTotalAmount')),
    totalAmount: num(tag(sums, 'GrandTotalAmount')),
    items,
    itemSummary,
    rawXml: xml,
  };
}
