# CFO 세금계산서 자동 처리 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 받은(매입) 세금계산서를 Outlook 메일에서 자동 수집·복호화·파싱해 DB/원장에 완전 자동 반영하고, 발행(매출) 세금계산서를 작성·표준XML·원장까지 자동화한다(국세청 전송만 수동). 팝빌 의존 없음.

**Architecture:** 국세청 홈택스 보안메일(`NTS_eTaxInvoice.html`)의 암호화된 첨부를 `MD5(우리 사업자번호)`를 키로 SEED/AES-CBC 복호화 → Base64 디코드 → 국세청 표준 `TaxInvoice` XML 파싱 → 매입 `TaxInvoice`+`Expense`+`LedgerEntry`에 멱등 posting. 순수 함수 3개 모듈(`html`/`header`/`decrypt`/`parse`)로 복호화·파싱을 격리하고, 서비스 계층이 인입·멱등·매칭을 오케스트레이션한다.

**Tech Stack:** TypeScript, Node 20, Express + tRPC (apps/api), Prisma (packages/db, `db push`), Vitest, Next.js (apps/web), 벤더링한 홈택스 CryptoJS rollup(seed.js/aes.js).

## Global Constraints

- 회사 사업자등록번호(복호화 키)는 **설정 DB**(`CompanySettings`)에 저장. 환경변수 아님.
- 실거래 `NTS_eTaxInvoice.html`은 **커밋 금지**(로컬 전용). 커밋되는 테스트는 동일 포맷의 **합성(synthetic) fixture**만 사용.
- DB 스키마 변경은 `prisma migrate`가 아니라 **`pnpm --filter @sangfor/db db:push`** 사용(기존 관례; 메모 "DB uses db push not migrate").
- 매입 자동 posting은 **멱등**해야 함: 승인번호(`issueId`) unique 기준 중복 차단.
- 복호화/파싱 실패는 **해당 1건만 격리**(status=`failed`), 배치 전체 중단 금지.
- 금액은 모두 정수 KRW(`Int`).
- 테스트 실행: `pnpm --filter @sangfor/api test` (vitest run). 단일 파일: `pnpm --filter @sangfor/api exec vitest run <path>`.
- 기존 finance 서비스 위치: `apps/api/src/services/finance/`. 신규 모듈도 동일 디렉토리 하위.

---

### Task 1: 홈택스 CryptoJS rollup 벤더링 + 로더

**Files:**
- Create: `apps/api/src/services/finance/hometax-securemail/vendor/seed.js` (다운로드)
- Create: `apps/api/src/services/finance/hometax-securemail/vendor/aes.js` (다운로드)
- Create: `apps/api/src/services/finance/hometax-securemail/vendor/README.md`
- Create: `apps/api/src/services/finance/hometax-securemail/crypto.ts`
- Test: `apps/api/src/services/finance/hometax-securemail/crypto.test.ts`

**Interfaces:**
- Produces: `loadCryptoJS(): CryptoJS` — `CryptoJS.SEED`, `CryptoJS.AES`, `CryptoJS.MD5`, `CryptoJS.enc.Base64`, `CryptoJS.enc.Hex`, `CryptoJS.enc.Utf8` 보유. 표준 npm `crypto-js`엔 SEED/ARIA가 없어 홈택스 공식 rollup을 vm으로 로드한다.

- [ ] **Step 1: 공식 rollup 다운로드 (벤더링)**

Run:
```bash
mkdir -p apps/api/src/services/finance/hometax-securemail/vendor
curl -sS -A "Mozilla/5.0" "https://srtk.hometax.go.kr/download/rollups/seed.js" -o apps/api/src/services/finance/hometax-securemail/vendor/seed.js
curl -sS -A "Mozilla/5.0" "https://srtk.hometax.go.kr/download/rollups/aes.js"  -o apps/api/src/services/finance/hometax-securemail/vendor/aes.js
wc -c apps/api/src/services/finance/hometax-securemail/vendor/seed.js apps/api/src/services/finance/hometax-securemail/vendor/aes.js
```
Expected: seed.js ≈ 22159 bytes, aes.js > 10000 bytes.

- [ ] **Step 2: vendor/README.md 작성**

```markdown
# Hometax CryptoJS rollups (vendored)

국세청 홈택스 보안메일 복호화용 공식 CryptoJS rollup.
출처: https://srtk.hometax.go.kr/download/rollups/{seed,aes}.js
- seed.js: CryptoJS core + MD5 + enc.Base64 + SEED (CBC) 포함
- aes.js : CryptoJS core + AES

표준 npm `crypto-js`에는 SEED/ARIA가 없으므로 벤더링한다.
`crypto.ts`가 vm 컨텍스트에서 로드해 `CryptoJS`를 추출한다.
```

- [ ] **Step 3: 실패 테스트 작성**

`crypto.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadCryptoJS } from './crypto';

describe('loadCryptoJS', () => {
  it('exposes SEED, AES, MD5 and encoders', () => {
    const C = loadCryptoJS();
    expect(typeof C.SEED?.decrypt).toBe('function');
    expect(typeof C.AES?.decrypt).toBe('function');
    expect(typeof C.MD5).toBe('function');
    expect(C.enc?.Base64).toBeTruthy();
    expect(C.enc?.Hex).toBeTruthy();
  });

  it('MD5 of business number is a 128-bit word array (4 words)', () => {
    const C = loadCryptoJS();
    const key = C.MD5('4208702727');
    expect(key.words.length).toBe(4);
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/hometax-securemail/crypto.test.ts`
Expected: FAIL ("Cannot find module './crypto'").

- [ ] **Step 5: crypto.ts 구현**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// 홈택스 공식 rollup을 격리된 vm 컨텍스트에서 로드해 CryptoJS를 추출한다.
// seed.js: core + MD5 + Base64 + SEED. aes.js: AES (동일 CryptoJS에 additive).
let cached: any | null = null;

export function loadCryptoJS(): any {
  if (cached) return cached;
  const dir = join(__dirname, 'vendor');
  const ctx: any = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(dir, 'seed.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(join(dir, 'aes.js'), 'utf8'), ctx);
  if (!ctx.CryptoJS?.SEED || !ctx.CryptoJS?.AES) {
    throw new Error('hometax CryptoJS rollups failed to load (SEED/AES missing)');
  }
  cached = ctx.CryptoJS;
  return cached;
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/hometax-securemail/crypto.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/finance/hometax-securemail/
git commit -m "feat(cfo): vendor hometax CryptoJS rollups + loader"
```

---

### Task 2: 보안메일 헤더 디코드 (header.ts)

**Files:**
- Create: `apps/api/src/services/finance/hometax-securemail/header.ts`
- Test: `apps/api/src/services/finance/hometax-securemail/header.test.ts`

**Interfaces:**
- Consumes: `loadCryptoJS()` (Task 1)
- Produces:
  ```ts
  export type SecureMailAlgorithm = 'AES' | 'SEED' | 'ARIA';
  export interface SecureMailAttachment { tagId: string; fileName: string; size: number; }
  export interface SecureMailHeader {
    algorithm: SecureMailAlgorithm;
    attachments: SecureMailAttachment[];
    hashKey: string;
    hintKey: string;
  }
  export function decodeHeader(criHeaderBase64: string): SecureMailHeader;
  ```

- [ ] **Step 1: 실패 테스트 작성**

`header.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { encodeHeaderForTest } from './__fixtures__/synthetic';
import { decodeHeader } from './header';

describe('decodeHeader', () => {
  it('decodes algorithm and attachment metadata from a synthetic header', () => {
    const criHeader = encodeHeaderForTest({
      algorithm: 2, // SEED
      hashKey: 'HASHKEYVALUE',
      hintKey: '사업자등록번호(10자리)',
      attachments: [{ tagId: 'idCriAttachContents0', fileName: 'sample.xml', size: 6854 }],
    });
    const header = decodeHeader(criHeader);
    expect(header.algorithm).toBe('SEED');
    expect(header.attachments).toEqual([
      { tagId: 'idCriAttachContents0', fileName: 'sample.xml', size: 6854 },
    ]);
    expect(header.hashKey).toBe('HASHKEYVALUE');
  });
});
```

> `encodeHeaderForTest` 는 Task 5에서 만든다. 이 태스크를 먼저 구현하려면 Task 5의 `synthetic.ts`를 함께 작성해야 한다 — 실행 순서상 Task 5의 `encodeHeaderForTest`만 우선 stub로 만들고, 본 fixture 전체는 Task 5에서 완성. (subagent 실행 시 Task 5 → Task 2 순으로 다뤄도 무방.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/hometax-securemail/header.test.ts`
Expected: FAIL ("Cannot find module './header'").

- [ ] **Step 3: header.ts 구현**

```ts
import { loadCryptoJS } from './crypto';

export type SecureMailAlgorithm = 'AES' | 'SEED' | 'ARIA';
export interface SecureMailAttachment { tagId: string; fileName: string; size: number; }
export interface SecureMailHeader {
  algorithm: SecureMailAlgorithm;
  attachments: SecureMailAttachment[];
  hashKey: string;
  hintKey: string;
}

const ALG: Record<string, SecureMailAlgorithm> = { '1': 'AES', '2': 'SEED', '3': 'ARIA' };

// idCriHeader: Base64 디코드 → 각 바이트 XOR 0x6b → 'Key:Value' 줄들
export function decodeHeader(criHeaderBase64: string): SecureMailHeader {
  const C = loadCryptoJS();
  const wa = C.enc.Base64.parse(criHeaderBase64);
  const { words, sigBytes } = wa;
  let s = '';
  for (let i = 0; i < sigBytes; i++) {
    const b = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    s += String.fromCharCode(b ^ 0x6b);
  }
  const lines = s.split(/\r\n|\n/);
  const get = (line: string) => line.slice(line.indexOf(':') + 1).trim();

  let algorithm: SecureMailAlgorithm = 'SEED';
  let hashKey = '';
  let hintKey = '';
  const names: string[] = [];
  const tagIds: string[] = [];
  const sizes: number[] = [];

  for (const line of lines) {
    if (line.startsWith('ContentEncryptionAlgorithm')) algorithm = ALG[get(line)] ?? 'SEED';
    else if (line.startsWith('HashKey')) hashKey = get(line);
    else if (line.startsWith('HintKey')) hintKey = get(line);
    else if (line.startsWith('AttachFileName')) names.push(get(line));
    else if (line.startsWith('AttachFileTagID')) tagIds.push(get(line));
    else if (line.startsWith('AttachFileSize')) sizes.push(parseInt(get(line), 10) || 0);
  }

  const attachments: SecureMailAttachment[] = names.map((fileName, i) => ({
    fileName,
    tagId: tagIds[i] ?? `idCriAttachContents${i}`,
    size: sizes[i] ?? 0,
  }));

  return { algorithm, attachments, hashKey, hintKey };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/hometax-securemail/header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/finance/hometax-securemail/header.ts apps/api/src/services/finance/hometax-securemail/header.test.ts
git commit -m "feat(cfo): decode hometax securemail header"
```

---

### Task 3: 첨부 복호화 (decrypt.ts)

**Files:**
- Create: `apps/api/src/services/finance/hometax-securemail/decrypt.ts`
- Test: `apps/api/src/services/finance/hometax-securemail/decrypt.test.ts`

**Interfaces:**
- Consumes: `loadCryptoJS()` (Task 1), `SecureMailAlgorithm` (Task 2)
- Produces:
  ```ts
  // 암호화된 첨부(base64) → SEED/AES-CBC 복호화 → 결과는 다시 base64 → 디코드 → XML 문자열
  export function decryptAttachmentToXml(
    encBase64: string, businessNumber: string, algorithm: SecureMailAlgorithm,
  ): string;
  ```

- [ ] **Step 1: 실패 테스트 작성**

`decrypt.test.ts`:
```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/hometax-securemail/decrypt.test.ts`
Expected: FAIL ("Cannot find module './decrypt'").

- [ ] **Step 3: decrypt.ts 구현**

```ts
import { loadCryptoJS } from './crypto';
import type { SecureMailAlgorithm } from './header';

// 키 = MD5(사업자번호), IV = 16바이트 0, 모드 CBC(기본).
// CryptoJS.<ALG>.decrypt(base64Str, key, {iv}) → 평문은 base64 → Buffer로 디코드 → UTF-8 XML.
export function decryptAttachmentToXml(
  encBase64: string,
  businessNumber: string,
  algorithm: SecureMailAlgorithm,
): string {
  const C = loadCryptoJS();
  const cipher = algorithm === 'AES' ? C.AES : C.SEED; // ARIA 미지원 시 SEED 폴백(현 표본=SEED)
  if (algorithm === 'ARIA') {
    throw new Error('ARIA algorithm not supported yet (no sample); vendor aria.js when needed');
  }
  const key = C.MD5(businessNumber);
  const iv = C.enc.Hex.parse('0'.repeat(32));
  const decrypted = cipher.decrypt(encBase64, key, { iv });
  const b64 = decrypted.toString(C.enc.Utf8);
  return Buffer.from(b64, 'base64').toString('utf8');
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/hometax-securemail/decrypt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/finance/hometax-securemail/decrypt.ts apps/api/src/services/finance/hometax-securemail/decrypt.test.ts
git commit -m "feat(cfo): decrypt hometax securemail attachment to XML"
```

---

### Task 4: 표준 TaxInvoice XML 파싱 (parse.ts)

**Files:**
- Create: `apps/api/src/services/finance/hometax-securemail/parse.ts`
- Test: `apps/api/src/services/finance/hometax-securemail/parse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface NormalizedLineItem { name: string; amount: number; tax: number; quantity: number; }
  export interface NormalizedTaxInvoice {
    issueId: string;            // 승인번호 (TaxInvoiceDocument/IssueID)
    issueDate: Date;            // ExchangedDocument/IssueDateTime (YYYYMMDDHHmmss)
    typeCode: string;           // TaxInvoiceDocument/TypeCode (예: 0101)
    supplierCorpNum: string;    // InvoicerParty/ID
    supplierName: string;       // InvoicerParty/NameText
    supplierCeoName: string;    // InvoicerParty/SpecifiedPerson/NameText
    supplierEmail: string | null;
    buyerCorpNum: string;       // InvoiceeParty/ID
    buyerName: string;          // InvoiceeParty/NameText
    buyerCeoName: string;       // InvoiceeParty/SpecifiedPerson/NameText
    buyerEmail: string | null;
    supplyAmount: number;       // SpecifiedMonetarySummation/ChargeTotalAmount
    vatAmount: number;          // SpecifiedMonetarySummation/TaxTotalAmount
    totalAmount: number;        // SpecifiedMonetarySummation/GrandTotalAmount
    items: NormalizedLineItem[];
    itemSummary: string;        // 첫 품목명 (+ 외 N건)
    rawXml: string;
  }
  export function parseTaxInvoiceXml(xml: string): NormalizedTaxInvoice;
  ```
- 의존성 없는 스코프 추출: 부모 블록(`InvoicerParty`/`InvoiceeParty`/`SpecifiedMonetarySummation`/`TaxInvoiceTradeLineItem`)을 잘라낸 뒤 그 안에서 태그를 읽는다(네임스페이스 없는 표준 스키마라 안정적). XML 파서 의존성 추가하지 않음.

- [ ] **Step 1: 실패 테스트 작성**

`parse.test.ts` (Task 5의 `SAMPLE_TAXINVOICE_XML` 상수 사용):
```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/hometax-securemail/parse.test.ts`
Expected: FAIL ("Cannot find module './parse'").

- [ ] **Step 3: parse.ts 구현**

```ts
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
  // YYYYMMDDHHmmss 또는 YYYYMMDD
  const y = +s.slice(0, 4), mo = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
  const h = +(s.slice(8, 10) || 0), mi = +(s.slice(10, 12) || 0), se = +(s.slice(12, 14) || 0);
  return new Date(y, mo, d, h, mi, se);
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
```

> 주의: `NameText`는 여러 블록에 등장하므로 반드시 부모 블록(`InvoicerParty` 등)을 먼저 잘라낸 뒤 그 안에서만 읽는다. `tag()`는 첫 매치를 반환하므로 블록 내 첫 `NameText`=상호, `SpecifiedPerson` 내 `NameText`=대표.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/hometax-securemail/parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/finance/hometax-securemail/parse.ts apps/api/src/services/finance/hometax-securemail/parse.test.ts
git commit -m "feat(cfo): parse standard NTS TaxInvoice XML"
```

---

### Task 5: 합성 fixture + 오케스트레이터(HTML→Normalized) E2E 테스트

**Files:**
- Create: `apps/api/src/services/finance/hometax-securemail/__fixtures__/synthetic.ts`
- Create: `apps/api/src/services/finance/hometax-securemail/index.ts`
- Test: `apps/api/src/services/finance/hometax-securemail/index.test.ts`

**Interfaces:**
- Produces (synthetic.ts — 테스트 전용, 실데이터 없음):
  ```ts
  export const SAMPLE_TAXINVOICE_XML: string; // 표준 스키마 합성 XML (검증값과 동일 숫자)
  export function encodeHeaderForTest(opts: {
    algorithm: number; hashKey: string; hintKey: string;
    attachments: { tagId: string; fileName: string; size: number }[];
  }): string;
  export function encryptXmlForTest(xml: string, businessNumber: string, algorithm: number): string;
  export function buildSecureMailHtmlForTest(xml: string, businessNumber: string): string;
  ```
- Produces (index.ts — 운영 오케스트레이터):
  ```ts
  export function extractSecureMailInputs(html: string): { header: string; attachments: Record<string, string> };
  export function parseSecureMailHtml(html: string, businessNumber: string): NormalizedTaxInvoice;
  export * from './parse'; export * from './header';
  ```

- [ ] **Step 1: synthetic.ts 작성 (fixture 생성기)**

```ts
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
```

- [ ] **Step 2: index.ts 실패 테스트 작성**

`index.test.ts`:
```ts
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
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/hometax-securemail/index.test.ts`
Expected: FAIL ("Cannot find module './index'").

- [ ] **Step 4: index.ts 구현**

```ts
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
```

- [ ] **Step 5: 통과 확인 (전체 모듈)**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/hometax-securemail/`
Expected: PASS (header/decrypt/parse/index/crypto 전부).

- [ ] **Step 6: (로컬 전용) 실데이터 회귀 검증 — 커밋 금지**

Run (개발자 로컬, 실제 파일 있을 때만):
```bash
node -e 'const {parseSecureMailHtml}=require("./apps/api/dist/services/finance/hometax-securemail"); const fs=require("fs"); console.log(parseSecureMailHtml(fs.readFileSync(process.env.HOME+"/Downloads/NTS_eTaxInvoice.html","utf8"),"4208702727"))'
```
Expected: 승인번호 202605291026052950358925, 합계 572000 출력. (이 단계는 커밋하지 않음.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/finance/hometax-securemail/__fixtures__/synthetic.ts apps/api/src/services/finance/hometax-securemail/index.ts apps/api/src/services/finance/hometax-securemail/index.test.ts
git commit -m "feat(cfo): synthetic fixture + securemail HTML→TaxInvoice orchestrator"
```

---

### Task 6: Prisma 스키마 확장 (TaxInvoice 필드 + CompanySettings)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`model TaxInvoice` 1570-1593; 신규 `model CompanySettings`)

**Interfaces:**
- Produces: `TaxInvoice.issueId @unique`, `supplierCeoName`, `buyerCeoName`, `itemSummary`, `sourceMessageId`, `expenseId`, `rawXml`; `CompanySettings { id, businessNumber, companyName, ... }`.

- [ ] **Step 1: TaxInvoice에 필드 추가**

`schema.prisma`의 `model TaxInvoice` 안, `memo` 위에 추가:
```prisma
  issueId         String?  @unique @map("issue_id")
  supplierCeoName String?  @map("supplier_ceo_name")
  buyerCeoName    String?  @map("buyer_ceo_name")
  itemSummary     String?  @map("item_summary")
  sourceMessageId String?  @map("source_message_id")
  expenseId       String?  @map("expense_id")
  rawXml          String?  @map("raw_xml")
```

- [ ] **Step 2: CompanySettings 모델 추가**

`model FinanceAccount` 아래에 추가:
```prisma
model CompanySettings {
  id             String   @id @default("default")
  businessNumber String   @map("business_number") // 복호화 키 (10자리)
  companyName    String?  @map("company_name")
  ceoName        String?  @map("ceo_name")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@map("finance_company_settings")
}
```

- [ ] **Step 3: db push 적용**

Run: `pnpm --filter @sangfor/db db:push`
Expected: "Your database is now in sync with your Prisma schema." (도구는 `prisma db push`; `migrate` 금지)

- [ ] **Step 4: Prisma client 재생성 확인**

Run: `pnpm --filter @sangfor/db exec prisma generate`
Expected: "Generated Prisma Client".

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): tax invoice automation fields + company settings"
```

---

### Task 7: 회사 설정 서비스 + 매입 인입 서비스 (멱등·매칭·원장)

**Files:**
- Create: `apps/api/src/services/finance/company-settings.service.ts`
- Create: `apps/api/src/services/finance/tax-invoice-inbound.service.ts`
- Test: `apps/api/src/services/finance/tax-invoice-inbound.service.test.ts`

**Interfaces:**
- Consumes: `parseSecureMailHtml` (Task 5), `LedgerService.post` (기존 `ledger.service.ts`), Prisma client.
- Produces:
  ```ts
  export function getCompanyBusinessNumber(): Promise<string>;
  // 결과 코드: 'created' | 'duplicate' | 'skipped_not_ours' | 'failed'
  export interface InboundResult { status: 'created'|'duplicate'|'skipped_not_ours'|'failed'; taxInvoiceId?: string; reason?: string; }
  export function ingestSecureMailHtml(html: string, sourceMessageId?: string): Promise<InboundResult>;
  ```

- [ ] **Step 1: company-settings.service.ts 구현**

먼저 기존 ledger 서비스 시그니처 확인:
Run: `grep -nE 'export (async )?function|postInvoice|class LedgerService|\.create\(' apps/api/src/services/finance/ledger.service.ts | head`
(실제 시그니처에 맞춰 Step 3의 원장 호출을 조정한다.)

```ts
import { prisma } from '@sangfor/db';

export async function getCompanyBusinessNumber(): Promise<string> {
  const s = await prisma.companySettings.findUnique({ where: { id: 'default' } });
  if (!s?.businessNumber) throw new Error('회사 사업자등록번호가 설정되지 않았습니다 (CFO 설정에서 등록)');
  return s.businessNumber.replace(/[^0-9]/g, '');
}

export async function setCompanySettings(input: { businessNumber: string; companyName?: string; ceoName?: string }) {
  const businessNumber = input.businessNumber.replace(/[^0-9]/g, '');
  return prisma.companySettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', businessNumber, companyName: input.companyName, ceoName: input.ceoName },
    update: { businessNumber, companyName: input.companyName, ceoName: input.ceoName },
  });
}
```

- [ ] **Step 2: 실패 테스트 작성**

`tax-invoice-inbound.service.test.ts` (Prisma는 실제 테스트 DB 사용 — 기존 `cfo.integration.test.ts` 패턴 따름. 그 파일에서 setup/teardown 방식 확인 후 동일하게):
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@sangfor/db';
import { SAMPLE_TAXINVOICE_XML, buildSecureMailHtmlForTest } from './hometax-securemail/__fixtures__/synthetic';
import { ingestSecureMailHtml } from './tax-invoice-inbound.service';

const BIZ = '4208702727';
const html = buildSecureMailHtmlForTest(SAMPLE_TAXINVOICE_XML, BIZ);

beforeEach(async () => {
  await prisma.taxInvoice.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.ledgerEntry.deleteMany({});
  await prisma.companySettings.upsert({
    where: { id: 'default' }, update: { businessNumber: BIZ },
    create: { id: 'default', businessNumber: BIZ },
  });
});

describe('ingestSecureMailHtml', () => {
  it('creates a purchase tax invoice + expense + ledger entry', async () => {
    const r = await ingestSecureMailHtml(html, 'msg-1');
    expect(r.status).toBe('created');
    const ti = await prisma.taxInvoice.findUnique({ where: { issueId: '202605291026052950358925' } });
    expect(ti?.direction).toBe('purchase');
    expect(ti?.totalAmount).toBe(572000);
    expect(ti?.expenseId).toBeTruthy();
    const ledger = await prisma.ledgerEntry.findMany({ where: { reference: ti!.id } });
    expect(ledger.length).toBeGreaterThan(0);
  });

  it('is idempotent on duplicate approval number', async () => {
    await ingestSecureMailHtml(html, 'msg-1');
    const r2 = await ingestSecureMailHtml(html, 'msg-1');
    expect(r2.status).toBe('duplicate');
    expect(await prisma.taxInvoice.count()).toBe(1);
  });

  it('skips invoices addressed to a different business number', async () => {
    const other = buildSecureMailHtmlForTest(
      SAMPLE_TAXINVOICE_XML.replace('<ID>4208702727</ID>', '<ID>9999999999</ID>'), BIZ);
    const r = await ingestSecureMailHtml(other, 'msg-2');
    expect(r.status).toBe('skipped_not_ours');
  });

  it('isolates a corrupt mail as failed without throwing', async () => {
    const r = await ingestSecureMailHtml('<html>broken</html>', 'msg-3');
    expect(r.status).toBe('failed');
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/tax-invoice-inbound.service.test.ts`
Expected: FAIL ("Cannot find module './tax-invoice-inbound.service'").

- [ ] **Step 4: tax-invoice-inbound.service.ts 구현**

```ts
import { prisma } from '@sangfor/db';
import { parseSecureMailHtml } from './hometax-securemail';
import { getCompanyBusinessNumber } from './company-settings.service';

export interface InboundResult {
  status: 'created' | 'duplicate' | 'skipped_not_ours' | 'failed';
  taxInvoiceId?: string;
  reason?: string;
}

export async function ingestSecureMailHtml(html: string, sourceMessageId?: string): Promise<InboundResult> {
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

  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        expenseName: n.itemSummary || n.supplierName,
        amount: n.supplyAmount, vat: n.vatAmount, total: n.totalAmount,
        category: '기타', vendor: n.supplierName, date: n.issueDate,
        proofType: '세금계산서', isPaid: false,
        memo: `자동수집 세금계산서 승인번호 ${n.issueId}`,
      },
    });
    const ti = await tx.taxInvoice.create({
      data: {
        direction: 'purchase', status: 'received',
        issueId: n.issueId,
        supplierCorpNum: n.supplierCorpNum, supplierName: n.supplierName, supplierCeoName: n.supplierCeoName,
        buyerCorpNum: n.buyerCorpNum, buyerName: n.buyerName, buyerCeoName: n.buyerCeoName,
        supplyAmount: n.supplyAmount, vatAmount: n.vatAmount, totalAmount: n.totalAmount,
        issueDate: n.issueDate, itemSummary: n.itemSummary,
        sourceMessageId, expenseId: expense.id, rawXml: n.rawXml,
      },
    });
    // 매입 분개: (차) 비용+부가세대급금 / (대) 미지급금. 원장 멱등은 reference=ti.id로 보장.
    await tx.ledgerEntry.createMany({
      data: [
        { date: n.issueDate, description: `매입 ${n.supplierName} ${n.itemSummary}`,
          debitAccount: '511', creditAccount: '253', amount: n.supplyAmount,
          reference: ti.id, referenceType: 'tax_invoice_purchase' },
        { date: n.issueDate, description: `매입 부가세대급금 ${n.supplierName}`,
          debitAccount: '135', creditAccount: '253', amount: n.vatAmount,
          reference: ti.id, referenceType: 'tax_invoice_purchase' },
      ],
    });
    return ti;
  });

  return { status: 'created', taxInvoiceId: result.id };
}
```

> 계정코드(511 비용 / 135 부가세대급금 / 253 미지급금)는 기존 `ledger.service.ts`의 코드 체계에 맞춰 조정한다(Step 1의 grep 결과 기준). 핵심은 `reference=ti.id`, `referenceType='tax_invoice_purchase'`로 멱등성과 추적성을 확보하는 것.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/tax-invoice-inbound.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/finance/company-settings.service.ts apps/api/src/services/finance/tax-invoice-inbound.service.ts apps/api/src/services/finance/tax-invoice-inbound.service.test.ts
git commit -m "feat(cfo): idempotent inbound tax-invoice ingestion with expense+ledger"
```

---

### Task 8: Outlook 동기화 연동 (hometaxadmin 감지 → 첨부 fetch → 인입)

**Files:**
- Modify: Outlook 동기화 코드 (Step 1에서 위치 확인)
- Create: `apps/api/src/services/finance/tax-invoice-mail-scan.service.ts`
- Test: `apps/api/src/services/finance/tax-invoice-mail-scan.service.test.ts`

**Interfaces:**
- Consumes: `ingestSecureMailHtml` (Task 7), Microsoft Graph 첨부 fetch, `MailMessage` 모델.
- Produces:
  ```ts
  export function isHometaxMail(msg: { fromEmail: string; subject: string }): boolean;
  export function scanAndIngestHometaxMails(accountId: string): Promise<{ scanned: number; created: number; duplicate: number; failed: number }>;
  ```

- [ ] **Step 1: Outlook 동기화/Graph 첨부 코드 위치 확인**

Run:
```bash
grep -rnE 'graph.microsoft.com|/messages|attachments|mailMessage|MailMessage|syncMail|outlook' apps/api/src apps/web/src/app/api/mail-import 2>/dev/null | grep -iE 'attach|sync|graph' | head -20
```
(첨부를 가져오는 Graph 호출 지점과 동기화 진입점을 찾아 거기서 `scanAndIngestHometaxMails`를 호출한다.)

- [ ] **Step 2: isHometaxMail 실패 테스트**

`tax-invoice-mail-scan.service.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isHometaxMail } from './tax-invoice-mail-scan.service';

describe('isHometaxMail', () => {
  it('matches NTS sender', () => {
    expect(isHometaxMail({ fromEmail: 'hometaxadmin@hometax.go.kr', subject: '(주)베를로 (..)' })).toBe(true);
  });
  it('ignores other senders', () => {
    expect(isHometaxMail({ fromEmail: 'someone@gmail.com', subject: 'hi' })).toBe(false);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/tax-invoice-mail-scan.service.test.ts`
Expected: FAIL.

- [ ] **Step 4: tax-invoice-mail-scan.service.ts 구현**

```ts
import { prisma } from '@sangfor/db';
import { ingestSecureMailHtml } from './tax-invoice-inbound.service';

const NTS_SENDER = 'hometax.go.kr';

export function isHometaxMail(msg: { fromEmail: string; subject: string }): boolean {
  return (msg.fromEmail || '').toLowerCase().includes(NTS_SENDER);
}

// Graph로 해당 메시지의 NTS_eTaxInvoice.html 첨부 본문(텍스트)을 가져온다.
// fetchAttachmentHtml은 기존 Graph 클라이언트를 주입받는다(Step 1에서 실제 클라이언트로 교체).
export async function scanAndIngestHometaxMails(
  accountId: string,
  fetchAttachmentHtml: (externalId: string) => Promise<string | null>,
): Promise<{ scanned: number; created: number; duplicate: number; failed: number }> {
  const stats = { scanned: 0, created: 0, duplicate: 0, failed: 0 };
  const messages = await prisma.mailMessage.findMany({
    where: { accountId, fromEmail: { contains: NTS_SENDER } },
  });
  for (const m of messages) {
    if (!m.externalId) continue;
    stats.scanned++;
    try {
      const html = await fetchAttachmentHtml(m.externalId);
      if (!html) { stats.failed++; continue; }
      const r = await ingestSecureMailHtml(html, m.id);
      if (r.status === 'created') stats.created++;
      else if (r.status === 'duplicate') stats.duplicate++;
      else if (r.status === 'failed') stats.failed++;
    } catch {
      stats.failed++; // 1건 실패가 배치를 막지 않음
    }
  }
  return stats;
}
```

- [ ] **Step 5: 동기화 진입점에 연결**

Step 1에서 찾은 Outlook 동기화 완료 지점에서 `scanAndIngestHometaxMails(accountId, graphFetchAttachmentHtml)` 호출 추가. `graphFetchAttachmentHtml`는 Graph `/messages/{id}/attachments` 에서 `contentType=text/html`(또는 첫 첨부)의 `contentBytes`(base64)를 디코드해 반환.

- [ ] **Step 6: 통과 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/tax-invoice-mail-scan.service.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/finance/tax-invoice-mail-scan.service.ts apps/api/src/services/finance/tax-invoice-mail-scan.service.test.ts
git commit -m "feat(cfo): scan Outlook for hometax mails and auto-ingest"
```

---

### Task 9: 발행(매출) 서비스 + 국세청 전송 어댑터

**Files:**
- Create: `apps/api/src/services/finance/nts-transmit.adapter.ts`
- Create: `apps/api/src/services/finance/tax-invoice-issue.service.ts`
- Test: `apps/api/src/services/finance/tax-invoice-issue.service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface NtsTransmitResult { status: 'pending_manual' | 'transmitted'; ref?: string; }
  export interface NtsTransmitter { transmit(taxInvoiceId: string): Promise<NtsTransmitResult>; }
  export const manualTransmitter: NtsTransmitter; // stub: 항상 pending_manual

  export interface IssueInput { buyerCorpNum: string; buyerName: string; buyerCeoName?: string; items: { name: string; amount: number }[]; }
  export function issueSalesTaxInvoice(input: IssueInput): Promise<{ id: string; status: string }>;
  export function markTransmitted(taxInvoiceId: string): Promise<void>;
  ```

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@sangfor/db';
import { issueSalesTaxInvoice, markTransmitted } from './tax-invoice-issue.service';

beforeEach(async () => {
  await prisma.taxInvoice.deleteMany({});
  await prisma.companySettings.upsert({
    where: { id: 'default' }, update: { businessNumber: '4208702727', companyName: '(주)베를로' },
    create: { id: 'default', businessNumber: '4208702727', companyName: '(주)베를로' },
  });
});

describe('issueSalesTaxInvoice', () => {
  it('computes VAT, creates a sales invoice pending manual transmission', async () => {
    const r = await issueSalesTaxInvoice({
      buyerCorpNum: '1234567890', buyerName: '바이어',
      items: [{ name: '컨설팅', amount: 1000000 }],
    });
    const ti = await prisma.taxInvoice.findUnique({ where: { id: r.id } });
    expect(ti?.direction).toBe('sales');
    expect(ti?.supplyAmount).toBe(1000000);
    expect(ti?.vatAmount).toBe(100000);
    expect(ti?.totalAmount).toBe(1100000);
    expect(ti?.status).toBe('pending_manual');
  });

  it('marks transmitted', async () => {
    const r = await issueSalesTaxInvoice({ buyerCorpNum: '1234567890', buyerName: '바이어', items: [{ name: 'x', amount: 100 }] });
    await markTransmitted(r.id);
    const ti = await prisma.taxInvoice.findUnique({ where: { id: r.id } });
    expect(ti?.status).toBe('transmitted');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/tax-invoice-issue.service.test.ts`
Expected: FAIL.

- [ ] **Step 3: nts-transmit.adapter.ts 구현**

```ts
export interface NtsTransmitResult { status: 'pending_manual' | 'transmitted'; ref?: string; }
export interface NtsTransmitter { transmit(taxInvoiceId: string): Promise<NtsTransmitResult>; }

// 기본: 자동 전송 안 함(수동 발급 전제). 추후 ASP 어댑터로 교체.
export const manualTransmitter: NtsTransmitter = {
  async transmit() { return { status: 'pending_manual' }; },
};
```

- [ ] **Step 4: tax-invoice-issue.service.ts 구현**

```ts
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
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/services/finance/tax-invoice-issue.service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/finance/nts-transmit.adapter.ts apps/api/src/services/finance/tax-invoice-issue.service.ts apps/api/src/services/finance/tax-invoice-issue.service.test.ts
git commit -m "feat(cfo): sales tax-invoice issuance + swappable NTS transmit adapter"
```

---

### Task 10: API 라우트 / tRPC

**Files:**
- Modify: `apps/api/src/routes/cfo.ts` (또는 신규 `apps/api/src/routers/cfo/tax-invoices.router.ts` — Step 1에서 기존 패턴 확인)
- Test: `apps/api/src/routers/cfo/tax-invoices.router.test.ts`

**Interfaces:**
- Endpoints/procedures:
  - `taxInvoices.list({ direction? })` → TaxInvoice[]
  - `taxInvoices.issue(IssueInput)` → { id, status }
  - `taxInvoices.markTransmitted({ id })`
  - `taxInvoices.scanMail({ accountId })` → 통계
  - `taxInvoices.uploadHtml({ html })` → InboundResult (수동 .html 업로드 폴백)
  - `companySettings.get()` / `companySettings.set(input)`

- [ ] **Step 1: 기존 라우터 패턴 확인**

Run: `sed -n '1,40p' apps/api/src/routers/cfo/invoices.router.ts`
(zod 스키마 + procedure 패턴을 그대로 따른다.)

- [ ] **Step 2: 실패 테스트 작성**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@sangfor/db';
import { SAMPLE_TAXINVOICE_XML, buildSecureMailHtmlForTest } from '../../services/finance/hometax-securemail/__fixtures__/synthetic';
import { appRouter } from '../index'; // 실제 루트 라우터 경로는 Step 1에서 확인

beforeEach(async () => {
  await prisma.taxInvoice.deleteMany({});
  await prisma.companySettings.upsert({ where: { id: 'default' }, update: { businessNumber: '4208702727' }, create: { id: 'default', businessNumber: '4208702727' } });
});

describe('taxInvoices router', () => {
  it('uploadHtml ingests and list returns it', async () => {
    const caller = appRouter.createCaller({} as any);
    const html = buildSecureMailHtmlForTest(SAMPLE_TAXINVOICE_XML, '4208702727');
    const r = await caller.taxInvoices.uploadHtml({ html });
    expect(r.status).toBe('created');
    const list = await caller.taxInvoices.list({ direction: 'purchase' });
    expect(list.length).toBe(1);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/routers/cfo/tax-invoices.router.test.ts`
Expected: FAIL.

- [ ] **Step 4: 라우터 구현**

```ts
import { z } from 'zod';
import { router, publicProcedure } from '../../trpc'; // 실제 헬퍼 경로는 invoices.router.ts와 동일하게
import { prisma } from '@sangfor/db';
import { ingestSecureMailHtml } from '../../services/finance/tax-invoice-inbound.service';
import { scanAndIngestHometaxMails } from '../../services/finance/tax-invoice-mail-scan.service';
import { issueSalesTaxInvoice, markTransmitted } from '../../services/finance/tax-invoice-issue.service';
import { getCompanyBusinessNumber, setCompanySettings } from '../../services/finance/company-settings.service';

export const taxInvoicesRouter = router({
  list: publicProcedure.input(z.object({ direction: z.enum(['sales', 'purchase']).optional() }).optional())
    .query(({ input }) => prisma.taxInvoice.findMany({
      where: input?.direction ? { direction: input.direction } : {},
      orderBy: { issueDate: 'desc' },
    })),
  uploadHtml: publicProcedure.input(z.object({ html: z.string() }))
    .mutation(({ input }) => ingestSecureMailHtml(input.html)),
  issue: publicProcedure.input(z.object({
    buyerCorpNum: z.string(), buyerName: z.string(), buyerCeoName: z.string().optional(),
    items: z.array(z.object({ name: z.string(), amount: z.number().int() })).min(1),
  })).mutation(({ input }) => issueSalesTaxInvoice(input)),
  markTransmitted: publicProcedure.input(z.object({ id: z.string() }))
    .mutation(({ input }) => markTransmitted(input.id)),
});

export const companySettingsRouter = router({
  get: publicProcedure.query(async () => {
    try { return { businessNumber: await getCompanyBusinessNumber() }; }
    catch { return { businessNumber: '' }; }
  }),
  set: publicProcedure.input(z.object({
    businessNumber: z.string().min(10), companyName: z.string().optional(), ceoName: z.string().optional(),
  })).mutation(({ input }) => setCompanySettings(input)),
});
```

루트 라우터에 등록(`taxInvoices`, `companySettings`). `scanMail`은 Graph fetcher 주입이 필요하므로 Task 8 진입점에서 직접 호출하거나, 라우터에서는 생략하고 동기화 시 자동 처리.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter @sangfor/api exec vitest run apps/api/src/routers/cfo/tax-invoices.router.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routers/cfo/tax-invoices.router.ts apps/api/src/routers/cfo/tax-invoices.router.test.ts apps/api/src/routers/
git commit -m "feat(cfo): tax-invoice + company-settings tRPC routers"
```

---

### Task 11: CFO UI — 세금계산서 화면 + 설정 사업자번호

**Files:**
- Create: `apps/web/src/app/cfo/(cfo)/tax-invoices/page.tsx`
- Modify: `apps/web/src/app/cfo/(cfo)/layout.tsx` (네비에 "세금계산서" 추가)
- Modify: `apps/web/src/app/cfo/(cfo)/settings/page.tsx` (사업자번호 설정 필드)

**Interfaces:**
- Consumes: `taxInvoices.list/issue/markTransmitted/uploadHtml`, `companySettings.get/set` (Task 10).

- [ ] **Step 1: 기존 CFO 페이지 패턴 확인**

Run: `sed -n '1,60p' apps/web/src/app/cfo/\(cfo\)/invoices/page.tsx`
(tRPC 클라이언트 사용·테이블·폼 패턴을 그대로 따른다. 기존 ledger 테마 유지.)

- [ ] **Step 2: tax-invoices/page.tsx 작성 — 매입/매출 탭**

매입 탭: `taxInvoices.list({direction:'purchase'})` 테이블(공급자·승인번호·작성일·공급가액·세액·합계·연결비용·상태) + `.html` 수동 업로드 입력(`uploadHtml`).
매출 탭: 발행 폼(`issue`) + 목록 + "전송완료 표시"(`markTransmitted`) 버튼.
(전체 JSX는 invoices/page.tsx 패턴을 그대로 따른다 — 컴포넌트 구조·스타일 동일.)

- [ ] **Step 3: layout.tsx 네비에 "세금계산서" 링크 추가**

기존 네비 배열에 `{ href: '/cfo/tax-invoices', label: '세금계산서' }` 추가(기존 항목과 동일 형식).

- [ ] **Step 4: settings/page.tsx 에 사업자번호 설정 추가**

`companySettings.get`으로 초기값 로드, 입력 필드 + 저장 버튼(`companySettings.set`). "복호화 키로 사용됨" 안내 문구.

- [ ] **Step 5: 수동 렌더 검증**

Run: `pnpm --filter @sangfor/web dev` 후 `/cfo/tax-invoices`, `/cfo/settings` 진입 — 매입 목록·발행 폼·사업자번호 저장이 동작하는지 확인.
(주의: 메모 "Web build pre-broken" — `next build`는 기존 이슈로 실패할 수 있으니 dev로 검증.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/cfo/
git commit -m "feat(cfo): tax-invoices UI (purchase/sales) + business number setting"
```

---

## Self-Review (작성자 점검 결과)

**Spec coverage:**
- §4 복호화/파싱 모듈 → Task 1–5 ✓
- §5 스키마 변경(issueId@unique 등) → Task 6 ✓
- §6 안전장치(멱등·실패격리·사업자번호검증·미매칭생성·원장멱등) → Task 7 (4개 테스트로 검증) ✓
- §2/§3 Outlook 자동 인입 → Task 8 ✓
- §7 발행 + 전송 어댑터 → Task 9 ✓
- §8 UI → Task 11 ✓; 설정 DB 사업자번호 → Task 6/7/10/11 ✓
- §9 합성 fixture·TDD → Task 5 (실데이터 회귀는 로컬 전용 Step) ✓

**Placeholder scan:** UI Task 11의 전체 JSX는 "기존 패턴을 따른다"로 위임 — 프론트는 기존 `invoices/page.tsx` 구조 재사용이 명확하므로 허용. 그 외 코드 스텝은 실제 코드 포함.

**Type consistency:** `NormalizedTaxInvoice`(Task 4) 필드명이 Task 5/7에서 일관(`supplyAmount`/`vatAmount`/`totalAmount`/`issueId`/`itemSummary`/`supplierCeoName`). `ingestSecureMailHtml`/`InboundResult`(Task 7) 시그니처가 Task 8/10에서 일치. `manualTransmitter`/`NtsTransmitter`(Task 9) 일관.

**알려진 조정 포인트(구현 중 확인):**
- ledger 계정코드 체계(Task 7) — 기존 `ledger.service.ts`에 맞춰 조정
- tRPC 헬퍼·루트 라우터 경로(Task 10) — 기존 `invoices.router.ts` 패턴에 맞춤
- Graph 첨부 fetch 구현(Task 8) — 기존 Outlook 동기화 코드에 맞춤
- Prisma 테스트 DB setup/teardown(Task 7) — 기존 `cfo.integration.test.ts` 방식 따름
