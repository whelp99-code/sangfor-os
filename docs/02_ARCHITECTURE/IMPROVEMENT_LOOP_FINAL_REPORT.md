# 개선 루프 최종 보고서 — SANGFOR Partner OS (Round 1–10)

> **명령**: 실사용 보고서 기반으로 개선 → 실사용(기존+새 관점) → 보고 → 개선을 "완전 제로(LOW 포함)"까지 반복. 라운드별 머지, 자율 진행, 상한 10 라운드.
> **결과**: 10 라운드 전부 완료·**main 머지**. 최고심각도(보안·재무정합·신뢰·핵심 i18n/a11y)는 소진. **완전 제로(LOW)에는 미도달** — 잔여 LOW/MED 롱테일과 아키텍처성 항목이 남아 재확인 요청.

---

## 1. 라운드별 성과 (전부 main 머지)

| R | PR | 테마 | 핵심 성과 |
|---|----|------|-----------|
| 1 | #50 | 신뢰 회복 | `/deals` 500 복구, 가짜수치 제거, no-op 버튼, VAT 공제+환급, 미수금 필터 |
| 2 | #51 | 재무 SSOT | 미수금 3값→단일, currentCash=실현금(≠미수금), estimatedVat, VAT 6/30 경계·half검증 |
| 3 | #52 | 보안+딜+목업 | 무인증 API 차단(플래그), 단계전이 강제, `Math.random` 목업 제거 |
| 4 | #53 | a11y+i18n+온보딩 | home h1, main 단일화, reduced-motion, aria-current, 제안서폼 한글화 |
| 5 | #54 | 딜/작업 구조 | 작업 담당자·프로젝트연결(+마이그레이션), 상태머신 통일, 딜 단계 enum 정합, 등록 게이트 |
| 6 | #55 | 성능+보안+MED | 대시보드 서버집계(over-fetch 제거), 보안 28라우트 가드, 입금라벨·presales·월결산 |
| 7 | #56 | 보안 CRITICAL+재무 | **finance web proxy 무인증 차단**, 10라우트 가드·rate limit, 미수건수 8/8/8, VAT 반기, 원장 재기표 |
| 8 | #57 | i18n 광범위 | executive-dashboard·통화 한글화, 작업 상태라벨, DataTable 빈상태, raw 에러키→한국어, 14개 영문 h1 |
| 9 | #58 | a11y+품질 | 폼 40개 접근명, 모달 포커스트랩, 키보드 정렬, 포맷 유틸 통합, AI 스텁 정직처리 |
| 10 | #59 | 성능+i18n+VAT | 서버 error 핸들러, 집계 memo·use-client 정리, 상세/레지스트리 한글화, VAT 분류 정정 |

**작동 방식(매 라운드)**: 계획 → 병렬 구현 에이전트(2–4) → 로컬 검증(typecheck/test/라이브) → PR·CI·머지 → 병렬 재실사용(회귀+새 관점). 총 개선 PR 10건, 회귀 유발 0.

## 2. 검증된 대표 성과 (라이브·CI)

- **버그**: `/deals` 500 → 200 렌더. 단계전이 WON→LEAD/스킵 400, 합법 200.
- **재무 정합**: 미수금 285M/259M/313M **→ 단일 259.4M**(부분입금 차감), 미수 건수 9/8/9 **→ 8/8/8**, currentCash **60.1M(실현금, ≠미수금)**, VAT 1기 종료 **6/30**(7/1 롤오버 제거), half=3 **→ 400**.
- **보안**: 무인증 finance web proxy + 40여 변경계 라우트 **가드(무플래그 401)**, 에러 스택 노출 제거, login rate limit.
- **i18n/a11y**: executive-dashboard·상세·레지스트리 한글화, 폼 접근명 40+, 모달 포커스트랩, home h1·main 단일.
- **성능**: 대시보드 over-fetch(500×2건) → 서버집계, API 서버 크래시 가드.
- **CI**: 매 라운드 build·lint·test·typecheck·secrets 그린. 최종 테스트 api 73 / web 111 통과.

## 3. 완전 제로 미도달 — 잔여 백로그

수렴 점검(R6 후)이 예상보다 **훨씬 큰 롱테일**을 드러냈고, R7–R10에서 최고심각도를 소진했으나 아래가 남았습니다. (심각도순)

### HIGH (아키텍처성 — 별도 설계 필요)
- **이중원장(ledger) P&L이 실매출과 괴리** — `postInvoice*`/`postExpense`가 create/update 시점에만 호출돼 시드·임포트 데이터가 원장 미반영. `/ledger/pnl` 값이 집계와 250배 차이(현재 UI 미노출). → **임포트 파이프라인 원장 백필** 또는 원장을 집계뷰로 파생하는 설계 필요.
- **딜별 손익 96% "미배정"** — invoice/expense의 engagementId 백필이 데모 1건뿐(실 CRM 데이터 필요). → Phase 2 backfill을 **실 딜 데이터**에 실행해야 실효.

### MED (범위·비중 큰 잔여)
- **i18n**: `approvals/[id]` 전면 하드코딩 영어 데모, `module-dashboard-client` 다수 영어, dev/portal/approvals 하위 페이지·상세 CardTitle 잔여, 일부 `toLocaleString` 로케일.
- **온보딩**: dev/portal/approvals/agent/integrations 빈상태 CTA 다수 미보강.
- **성능**: 상세페이지(deals/opportunities [id]) engagement fetch 워터폴, 일부 클라 집계.
- **a11y**: 폼 native `<select>` aria-label 잔여, 정렬 외 인터랙션 키보드, tax-invoices 외 커스텀 탭.

### LOW (대량 잔여)
- 저대비 `text-[11px]`+muted 다수, sr-only 잔여 영문, `mcp-tools` aria-current boolean, AIWorkspaceLayout 계열 영문 h1 잔여.
- 보안: 저위험 read/validate 라우트 ~10개 미가드(재무 GET은 설계상 오픈), login mock-mode admin.
- 품질: `formatDate`(Intl date-time형) 잔여 중복, `module-dashboard` 가짜 ping(Math.random) 스텁, 미사용 export, alert() 에러처리.
- 데드/데모: `approvals` 하드코딩 데이터, 일부 빈 배열 하드코딩.

> **추정**: LOW 롱테일까지 "완전 제로"는 **약 5–10 라운드 추가** 필요(대부분 기계적 한글화·a11y 속성·중복제거이나 파일 수가 많음). ledger 백필·딜 backfill은 실데이터/설계 결정이 선행.

## 4. 권장 (재확인 요청)

- **옵션 A**: 상한을 늘려(예: +8) LOW 롱테일까지 계속 → 실질 완전 제로 근접.
- **옵션 B**: 아키텍처성 HIGH 2건(원장 백필·딜 backfill)만 별도 설계·처리하고, LOW는 "인지된 백로그"로 두고 마감.
- **옵션 C**: 현 상태로 마감(핵심 심각도 전부 처리됨) + 잔여는 이 문서를 백로그로 사용.

10 라운드로 **사용자 영향이 큰 결함(보안 무인증, 재무 오계산, /deals 다운, 광범위 영문·접근성)은 모두 해소**됐습니다. 남은 것은 주로 비핵심 페이지의 i18n/a11y/품질 롱테일과 두 건의 아키텍처 항목입니다.
