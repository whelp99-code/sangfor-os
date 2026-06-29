# CFO 세금계산서 자동 처리 — 설계 (Design)

- 작성일: 2026-06-29
- 상태: 설계 확정 대기 (사용자 리뷰 전)
- 관련 메모: HomeTax secure-mail decryption, Outlook mail integration

## 1. 배경 / 문제

현재 CFO에서 **발행(매출) 세금계산서와 받은(매입) 세금계산서를 자동으로 처리할 수 없다.**
- 매출 인보이스는 `invoices/page.tsx`에서 수동 CRUD만 가능
- 받은 세금계산서는 시스템에 들어오는 경로 자체가 없음
- `TaxInvoice` 모델과 `popbill.service.ts`(mock 위주) 골격은 있으나 자동화/UI 미연결

목표: **팝빌(외부 ASP) 의존 없이 자체 개발**로
- 받은 세금계산서 = **완전 자동** 수집·파싱·반영
- 발행 세금계산서 = 작성·표준XML·원장까지 자동 + 국세청 전송만 수동(교체형 어댑터)

## 2. 핵심 검증된 사실 (Proof of Concept 완료)

국세청 홈택스 발급 메일은 `hometaxadmin@hometax.go.kr` 발신, 첨부 `NTS_eTaxInvoice.html`(보안메일)로 도착한다. 실제 데이터는 암호화돼 hidden input에 들어 있고, **우리 사업자등록번호를 키로 자체 복호화 가능**함을 실제 파일로 검증했다(2026-06-29).

복호화 알고리즘(홈택스 공개 `cri_ems_nt.js` + CryptoJS rollups, `srtk.hometax.go.kr/download/`):
1. `idCriHeader` = Base64 디코드 → 각 바이트 `XOR 0x6b` → 줄단위 파싱
   - `ContentEncryptionAlgorithm`: 1=AES, 2=SEED, 3=ARIA
   - `AttachFileName`(표준 .xml), `AttachFileTagID`(`idCriAttachContents0`), `AttachFileSize`
2. 키 = `MD5(수신자_사업자등록번호10자리)`, IV = 16바이트 전부 0, 모드 = CBC
3. 첨부 복호화: `CryptoJS.<ALG>.decrypt(attBase64, key, {iv})` → 결과는 **다시 Base64** → 디코드 → 국세청 표준 `TaxInvoice` XML (KEC 스키마 `urn:kr:or:kec:standard:Tax:...`)
4. XML에서 항목 추출: `IssueDateTime`(작성일자), `IssueID`(승인번호), 공급자/공급받는자 사업자번호·상호(`NameText`)·대표(`NameText`), `ChargeTotalAmount`(공급가액), 세액, `GrandTotalAmount`(합계), 품목(`Description`)

검증 샘플: (주)베를로(사업자 4208702727) ← 주식회사 넥시아스, "Sangfor Term License", 520,000 / 52,000 / 572,000.

> Node 구현 메모: 표준 npm `crypto-js`에는 SEED/ARIA가 없다. 홈택스 `seed.js` rollup(core+MD5+Base64+SEED 포함)을 그대로 vm/모듈로 로드해 호출한다.

## 3. 확정된 결정 (사용자)

1. **국세청 전송**: 수동 발급 전제 — 우리 시스템은 작성·표준XML/PDF·원장까지 자동, 실제 전송만 수동(상태로 추적), 어댑터로 분리해 추후 ASP 교체 가능
2. **매입 인입 경로**: 기존 **Outlook 동기화로 자동 감지**(`hometaxadmin@hometax.go.kr` 발신 메일)
3. **매입 자동화 수준**: **완전 자동 posting** (검토 게이트 없음). 단, 멱등성·실패 격리·미매칭 처리로 안전성 확보

## 4. 아키텍처 (격리된 유닛)

기존 finance 로직은 `apps/api/src/services/finance/`에 모여 있다. 신규 유닛도 여기 추가하고, 순수 로직은 테스트 가능하게 분리한다.

```
[Outlook 동기화] --(hometaxadmin 발신 .eml/HTML 첨부)-->
  hometax-securemail/        (순수 함수, 외부 의존 없음)
    ├─ header.ts      : idCriHeader 디코드(Base64+XOR0x6b) → {alg, attachTagIds, attachNames}
    ├─ decrypt.ts     : SEED/AES/ARIA-CBC 복호화 (key=MD5(bizNo), iv=0) → Base64 디코드 → XML
    └─ parse.ts       : 표준 TaxInvoice XML → NormalizedTaxInvoice 객체
  tax-invoice-inbound.service.ts : 인입 오케스트레이션 + 멱등 저장 + 매칭/원장 posting
  tax-invoice-issue.service.ts   : 발행(매출) 작성 → 표준XML/PDF → 원장, 전송은 어댑터
  nts-transmit.adapter.ts        : 전송 어댑터 인터페이스 (manual stub / 추후 ASP)
```

데이터 흐름(매입, 완전 자동):
```
Outlook sync → fromEmail=hometaxadmin@hometax.go.kr 감지
  → Graph로 HTML 첨부 가져오기
  → header.decode → decrypt(우리 사업자번호) → parse → NormalizedTaxInvoice
  → 멱등 upsert: TaxInvoice(direction='purchase', issueId 기준 중복 차단)
  → Expense 자동 생성 + 매칭(거래처/금액/일자)
  → LedgerService 매입 분개 posting
  → 처리 결과를 MailMessage에 연결 / 실패 시 status='failed'로 격리(로그)
```

## 5. 데이터 모델 변경 (Prisma, db push)

`TaxInvoice`에 인입 자동화용 필드 추가:
- `issueId String? @unique` — 국세청 승인번호 (멱등 키). `direction='purchase'`에서 중복 방지의 핵심
- `supplierCEOName`, `buyerCEOName String?` — 대표자명
- `itemSummary String?` — 대표 품목명(첫 품목 또는 요약)
- `sourceMessageId String?` — 출처 `MailMessage.id` 링크 (감사 추적)
- `expenseId String?` — 자동 생성/매칭된 `Expense` 링크
- `rawXml String?` — 복호화된 표준 XML 원본 보관 (재처리/감사용; `rawResponse`와 별도)

> `issueId @unique`로 같은 세금계산서가 메일 재동기화돼도 한 번만 저장됨(멱등성).

## 6. 안전장치 (완전 자동이므로 필수)

- **멱등성**: `issueId` unique upsert. 이미 있으면 skip(no-op)
- **복호화/파싱 실패 격리**: 예외는 해당 메일만 `failed`로 마크하고 다음 메일 계속. 전체 동기화 중단 금지. 실패 사유 로깅
- **사업자번호 검증**: 파싱된 `buyerCorpNum`이 우리 회사 번호와 일치하는지 확인(아니면 skip + 경고)
- **미매칭 비용**: 대응 `Expense`를 못 찾으면 새 `Expense`를 `category='기타'`, `proofType='세금계산서'`로 생성하고 `TaxInvoice.expenseId` 연결
- **원장 멱등**: `LedgerEntry.reference=TaxInvoice.id`, `referenceType='tax_invoice_purchase'`로 중복 분개 방지

## 7. 발행(매출) 측

- 작성 폼(공급받는자·품목·금액) → VAT 자동 계산 → 표준 `TaxInvoice` XML/PDF 생성 → `direction='sales'`, `status='draft'` 저장 → 원장 매출 분개
- `nts-transmit.adapter.ts`: 인터페이스 `transmit(taxInvoice): {status, ref}`. 기본 구현 = manual stub(상태만 `pending_manual`→사용자가 홈택스 발급 후 `transmitted`로 마크). 추후 ASP 어댑터 추가 시 이 인터페이스만 구현
- 이번 범위에서는 매입 자동화가 1순위, 발행은 작성·원장·상태관리까지(전송 자동화 제외)

## 8. UI (CFO)

- 신규 라우트 `cfo/(cfo)/tax-invoices/`
  - **매입 탭**: 자동 수집된 세금계산서 목록(공급자·금액·작성일·승인번호·연결된 Expense·상태). 읽기 중심 + 수동 재처리 버튼
  - **매출 탭**: 작성 폼 + 발행 상태(draft/pending_manual/transmitted)
- `settings/page.tsx`: 우리 회사 사업자등록번호(복호화 키) 설정 항목 추가, Outlook 연결 상태 표시

## 9. 테스트 전략 (TDD)

- `hometax-securemail` 3개 순수 모듈은 **실제 샘플 기반 단위 테스트**:
  - fixture: 검증에 쓴 `NTS_eTaxInvoice.html` 1건을 `apps/api/src/services/finance/__fixtures__/`에 보관(민감정보 — 결정 필요: 커밋 vs 로컬/gitignore + 합성 fixture 추가)
  - header 디코드 → alg=2(SEED), attach 메타 일치
  - decrypt+parse → 기대 항목(승인번호 202605291026052950358925, 520,000/52,000/572,000, 공급자 주식회사 넥시아스) 일치
- inbound service: 멱등성(같은 issueId 2회 → TaxInvoice 1건), 실패 격리(깨진 첨부 1건이 배치 중단 안 함), buyerCorpNum 불일치 skip
- 발행 service: VAT 계산, 원장 분개, 어댑터 stub 상태 전이

## 10. 범위 밖 (YAGNI)

- 국세청 실시간 전송(ASP/ERP 인증) — 어댑터 자리만 남김
- PDF OCR 경로 — 홈택스 첨부는 표준 XML이라 불필요
- AES/ARIA 실경로 — 알고리즘 분기는 구현하되 현 샘플은 SEED. 다른 발급처 메일 입수 시 검증

## 11. 확정된 세부 결정

1. **테스트 fixture**: 실거래 `NTS_eTaxInvoice.html`은 **저장소에 커밋하지 않음**(개발자 로컬 보관). 커밋되는 단위 테스트는 값을 가린 **합성(synthetic) fixture**를 사용. 단, 합성 fixture는 동일한 보안메일 포맷(Base64+XOR0x6b 헤더, SEED-CBC 암호화, Base64 이중 인코딩, 표준 TaxInvoice XML)을 그대로 재현해 디코드/복호화/파싱 경로를 모두 커버해야 함. (실데이터 회귀 검증은 로컬에서 수동 1회)
2. **회사 사업자등록번호(복호화 키)**: **설정 DB**에 저장(설정 화면에서 관리). 추후 다회사 대비. 환경변수 아님.
