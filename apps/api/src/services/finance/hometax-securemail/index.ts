import { decodeHeader } from './header';
import { decryptAttachmentToXml } from './decrypt';
import { parseTaxInvoiceXml, type NormalizedTaxInvoice } from './parse';

export * from './header';
export * from './parse';

const inputValue = (html: string, id: string): string => {
  const tag = html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`, 'i'));
  if (!tag) return '';
  const v = tag[0].match(/\bvalue="([^"]*)"/i);
  return v ? v[1] : '';
};

export function extractSecureMailInputs(html: string): { header: string; attachments: Record<string, string> } {
  const header = inputValue(html, 'idCriHeader');
  const attachments: Record<string, string> = {};
  const tagRe = /<input[^>]*>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(html))) {
    const tag = tagMatch[0];
    const idMatch = tag.match(/\bid="(idCriAttachContents\d+)"/i);
    const valMatch = tag.match(/\bvalue="([^"]*)"/i);
    if (idMatch && valMatch) attachments[idMatch[1]] = valMatch[1];
  }
  return { header, attachments };
}

export function parseSecureMailHtml(html: string, businessNumber: string): NormalizedTaxInvoice {
  const { header, attachments } = extractSecureMailInputs(html);
  const meta = decodeHeader(header);
  const xmlAttach = meta.attachments.find((a) => a.fileName.toLowerCase().endsWith('.xml')) ?? meta.attachments[0];
  if (!xmlAttach) throw new Error('no attachment in secure mail');
  const enc = attachments[xmlAttach.tagId];
  if (!enc) throw new Error(`attachment ${xmlAttach.tagId} not found in html`);
  const xml = decryptAttachmentToXml(enc, businessNumber, meta.algorithm);
  if (!xml.includes('<TaxInvoice')) throw new Error('decryption produced non-TaxInvoice content (wrong business number?)');
  return parseTaxInvoiceXml(xml);
}
