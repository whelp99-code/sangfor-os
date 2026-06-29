import { loadCryptoJS } from '../crypto';

// 실거래 데이터 아님. 검증에 쓴 값과 동일한 '숫자/구조'만 재현한 합성 표준 XML.
export const SAMPLE_TAXINVOICE_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<TaxInvoice xmlns="urn:kr:or:kec:standard:Tax:...">',
  '<ExchangedDocument><IssueDateTime>20260529153132</IssueDateTime></ExchangedDocument>',
  '<TaxInvoiceDocument><IssueID>202605291026052950358925</IssueID>',
  '<TypeCode>0101</TypeCode><PurposeCode>02</PurposeCode>',
  '<IssueDateTime>20260529</IssueDateTime></TaxInvoiceDocument>',
  '<TaxInvoiceTradeSettlement>',
  '<InvoicerParty><ID>1888602772</ID><NameText>주식회사 넥시아스</NameText>',
  '<SpecifiedPerson><NameText>황규현</NameText></SpecifiedPerson>',
  '<DefinedContact><URICommunication>tax@nexias.example</URICommunication></DefinedContact>',
  '</InvoicerParty>',
  '<InvoiceeParty><ID>4208702727</ID><NameText>(주)베를로</NameText>',
  '<SpecifiedPerson><NameText>박재민</NameText></SpecifiedPerson>',
  '<PrimaryDefinedContact><URICommunication>buyer@blro.example</URICommunication></PrimaryDefinedContact>',
  '</InvoiceeParty>',
  '<SpecifiedMonetarySummation><ChargeTotalAmount>520000</ChargeTotalAmount>',
  '<TaxTotalAmount>52000</TaxTotalAmount><GrandTotalAmount>572000</GrandTotalAmount>',
  '</SpecifiedMonetarySummation>',
  '</TaxInvoiceTradeSettlement>',
  '<TaxInvoiceTradeLineItem><SequenceNumeric>1</SequenceNumeric>',
  '<InvoiceAmount>520000</InvoiceAmount><ChargeableUnitQuantity>1</ChargeableUnitQuantity>',
  '<NameText>Sangfor Term License</NameText>',
  '<TotalTax><CalculatedAmount>52000</CalculatedAmount></TotalTax>',
  '</TaxInvoiceTradeLineItem>',
  '</TaxInvoice>',
].join('');

const ALG_CIPHER = (C: any, algorithm: number) => (algorithm === 1 ? C.AES : C.SEED);

export function encryptXmlForTest(xml: string, businessNumber: string, algorithm: number): string {
  if (algorithm === 3) throw new Error('ARIA not supported in test fixture');
  const C = loadCryptoJS();
  const key = C.MD5(businessNumber);
  const iv = C.enc.Hex.parse('0'.repeat(32));
  const b64 = Buffer.from(xml, 'utf8').toString('base64');       // 첨부는 base64 이중 인코딩
  const wordArray = C.enc.Utf8.parse(b64);
  const enc = ALG_CIPHER(C, algorithm).encrypt(wordArray, key, { iv });
  return enc.toString(); // OpenSSL base64 형식 — decrypt가 동일하게 파싱
}

export function encodeHeaderForTest(opts: {
  algorithm: number; hashKey: string; hintKey: string;
  attachments: { tagId: string; fileName: string; size: number }[];
}): string {
  const C = loadCryptoJS();
  const lines: string[] = [];
  lines.push(`ContentEncryptionAlgorithm:${opts.algorithm}`);
  lines.push(`HintKey:${opts.hintKey}`);
  lines.push(`HashKey:${opts.hashKey}`);
  lines.push(`AttachFileCount:${opts.attachments.length}`);
  for (const a of opts.attachments) {
    lines.push(`AttachFileName:${a.fileName}`);
    lines.push(`AttachFileTagID:${a.tagId}`);
    lines.push(`AttachFileSize:${a.size}`);
  }
  const plain = lines.join('\n');
  // XOR 0x6b 후 base64
  const bytes = Buffer.from(plain, 'utf8').map((b) => b ^ 0x6b);
  const wa = C.enc.Hex.parse(Buffer.from(bytes).toString('hex'));
  return C.enc.Base64.stringify(wa);
}

export function buildSecureMailHtmlForTest(xml: string, businessNumber: string): string {
  const header = encodeHeaderForTest({
    algorithm: 2, hashKey: 'HK', hintKey: 'biz',
    attachments: [{ tagId: 'idCriAttachContents0', fileName: 's.xml', size: xml.length }],
  });
  const att = encryptXmlForTest(xml, businessNumber, 2);
  return `<html><body>
    <input type="hidden" id="idCriHeader" value="${header}">
    <input type="hidden" id="idCriAttachContents0" value="${att}">
  </body></html>`;
}
