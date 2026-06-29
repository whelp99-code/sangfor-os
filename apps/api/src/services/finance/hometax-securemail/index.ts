import { decodeHeader } from './header';
import { decryptAttachmentToXml } from './decrypt';
import { parseTaxInvoiceXml, type NormalizedTaxInvoice } from './parse';

export * from './header';
export * from './parse';

const inputValue = (html: string, id: string): string => {
  const m = html.match(new RegExp(`id="${id}"\\s+value="([^"]*)"`));
  return m ? m[1] : '';
};

export function extractSecureMailInputs(html: string): { header: string; attachments: Record<string, string> } {
  const header = inputValue(html, 'idCriHeader');
  const attachments: Record<string, string> = {};
  const re = /id="(idCriAttachContents\d+)"\s+value="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) attachments[m[1]] = m[2];
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
