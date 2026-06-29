import { describe, it, expect } from 'vitest';
import { encryptXmlForTest } from './__fixtures__/synthetic';
import { decryptAttachmentToXml } from './decrypt';

describe('decryptAttachmentToXml', () => {
  it('round-trips a SEED-encrypted, base64-wrapped XML', () => {
    const xml = '<TaxInvoice><A>1</A></TaxInvoice>';
    const enc = encryptXmlForTest(xml, '4208702727', 2); // SEED
    expect(decryptAttachmentToXml(enc, '4208702727', 'SEED')).toBe(xml);
  });

  it('fails with wrong business number', () => {
    const enc = encryptXmlForTest('<x/>', '4208702727', 2);
    expect(decryptAttachmentToXml(enc, '0000000000', 'SEED')).not.toContain('<x/>');
  });
});
