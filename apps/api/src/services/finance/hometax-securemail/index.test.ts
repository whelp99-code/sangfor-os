import { describe, it, expect } from 'vitest';
import { SAMPLE_TAXINVOICE_XML, buildSecureMailHtmlForTest } from './__fixtures__/synthetic';
import { parseSecureMailHtml, extractSecureMailInputs } from './index';

describe('parseSecureMailHtml (E2E)', () => {
  const html = buildSecureMailHtmlForTest(SAMPLE_TAXINVOICE_XML, '4208702727');

  it('extracts hidden inputs', () => {
    const inputs = extractSecureMailInputs(html);
    expect(inputs.header).toBeTruthy();
    expect(inputs.attachments['idCriAttachContents0']).toBeTruthy();
  });

  it('decodes → decrypts → parses end-to-end', () => {
    const r = parseSecureMailHtml(html, '4208702727');
    expect(r.issueId).toBe('202605291026052950358925');
    expect(r.totalAmount).toBe(572000);
    expect(r.supplierName).toBe('주식회사 넥시아스');
  });
});
