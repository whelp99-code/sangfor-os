import { describe, it, expect } from 'vitest';
import { SAMPLE_TAXINVOICE_XML } from './__fixtures__/synthetic';
import { parseTaxInvoiceXml } from './parse';

describe('parseTaxInvoiceXml', () => {
  it('extracts the legal fields from a standard TaxInvoice XML', () => {
    const r = parseTaxInvoiceXml(SAMPLE_TAXINVOICE_XML);
    expect(r.issueId).toBe('202605291026052950358925');
    expect(r.supplierCorpNum).toBe('1888602772');
    expect(r.supplierName).toBe('주식회사 넥시아스');
    expect(r.supplierCeoName).toBe('황규현');
    expect(r.buyerCorpNum).toBe('4208702727');
    expect(r.buyerName).toBe('(주)베를로');
    expect(r.buyerCeoName).toBe('박재민');
    expect(r.supplyAmount).toBe(520000);
    expect(r.vatAmount).toBe(52000);
    expect(r.totalAmount).toBe(572000);
    expect(r.items[0].name).toBe('Sangfor Term License');
    expect(r.itemSummary).toBe('Sangfor Term License');
    expect(r.issueDate.getFullYear()).toBe(2026);
  });
});
