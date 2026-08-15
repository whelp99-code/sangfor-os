# R16–R20 실제 사용자 시나리오 QA

> 날짜: 2026-07-13 · 브랜치: `fix/ux-loop-2026-07-13`
> 방식: Sol이 격리 QA DB와 실제 브라우저/API를 실행하고, Grok이 매 라운드 독립 시나리오와 반례를 검토했다.

## 실행 계약

- 한 라운드는 서로 다른 실사용 시나리오 10개로 고정한다.
- 각 라운드는 `정의 → 실행 → Grok 반례검토 → 문제 수정 → 회귀검증` 순서로 닫는다.
- 쓰기 검증은 `sangfor_os_uxtest_r16r20`, Redis DB 14, web `:3110`, api `:3230`에서만 했다.
- `PASS(차단)`은 위험한 동작이 의도한 오류 코드나 비활성 상태로 거부된 경우다.
- 단, 기존 business 테스트 4개가 자체적으로 루트 `.env`를 읽는 비격리 테스트였고, 초기 테스트 실행 중 운영 DB에 감사성 로그 34행(`domain_decision_logs` 31, `state_transition_logs` 3)을 남겼다. 고객/딜/후보 fixture 본체는 테스트 cleanup으로 제거됐다. 재발 방지를 위해 해당 테스트를 `CI_INTEGRATION=1` 게이트로 전환했으며, 운영 로그 삭제는 승인 전까지 수행하지 않았다.

## R16 — 교정·보관·강제 전환

| ID | 사용자 시나리오 | 실행 결과 | 발견 및 개선 |
|---|---|---|---|
| R16-01 | 고객 오표기 수정 | PASS · PATCH 200 | 교정 기록 유지 확인 |
| R16-02 | 고객 보관 후 복원 | PASS · 200/200 | 삭제가 아닌 보관임을 확인문에 명시 |
| R16-03 | 파트너 정보 수정 | PASS · PATCH 200 | 단건 라우트에 프로젝트 범위 적용 |
| R16-04 | 다른 프로젝트의 파트너 접근 | PASS(차단) · 403 | 단건/목록 모두 서버 계산 scope로 통일 |
| R16-05 | 연락처 이름·메일·직책 수정 | PASS · PATCH 200 | 연락처 수정 API와 결정 로그 추가 |
| R16-06 | 연락처 보관 | PASS · DB `archivedAt` 확인 | nullable 필드와 정식 마이그레이션 추가 |
| R16-07 | 다른 프로젝트 부모에 연락처 추가 | PASS(차단) · 404 | customer/partner 부모 scope 검증 추가 |
| R16-08 | 완료 작업을 진행 중으로 되돌려 교정 | PASS · PATCH 200 | 상태 교정 경로 확인 |
| R16-09 | 작업 보관 | PASS · DB 보관 확인 | 상세 화면에 누락됐던 보관 액션 추가 |
| R16-10 | POC 없는 딜 전환 후 명시적 강제 전환 | PASS · 409 `conversion_requires_poc`, 확인 후 201 | catch-all 오류를 안정 코드로 분리하고 강제 확인창 추가 |

## R17 — 기능 도달 가능성

| ID | 사용자 시나리오 | 실행 결과 | 발견 및 개선 |
|---|---|---|---|
| R17-01 | 파트너 상세에서 수정·보관 | PASS · 페이지/API 200 | 단건 경로 착륙 |
| R17-02 | 고객 상세에서 연락처 수정·보관 | PASS · 페이지/API 200 | 고객 허브에서 직접 완료 가능 |
| R17-03 | 월 마감 시작 | PASS · POST 200 | 읽기 전용 화면에 실행 컴포넌트 추가 |
| R17-04 | 체크리스트 미충족 상태에서 마감 완료 | PASS(차단) · 버튼 disabled, API 실패 | 미수 7건을 숨기지 않고 완료 차단 |
| R17-05 | 갱신 상태 단계 변경 | PASS · PATCH 200 | renewal business/API/select 추가 |
| R17-06 | 갱신 카드에서 고객 허브 이동 | PASS · 링크 1개 확인 | 고객 컨텍스트 복귀 경로 추가 |
| R17-07 | VAT 기본 반기 조회 | PASS · 200 | 기본 기간 유지 |
| R17-08 | VAT 2025년 2기 재조회 | PASS · 200, 매입세액 1,209,000원 | 연도·기수 폼 추가 |
| R17-09 | 강제 전환 진입점 재확인 | PASS(차단) · 409 안정 코드 | 일반 실패와 강제 가능 실패를 구분 |
| R17-10 | 고객·작업 교정 상세 재진입 | PASS · 200/200 | 보관 뒤 목록 복귀 경로 확인 |

## R18 — 재무 수치와 오류의 진실성

| ID | 사용자 시나리오 | 실행 결과 | 발견 및 개선 |
|---|---|---|---|
| R18-01 | KPI 미수금과 DB 잔액 합계 대조 | PASS · 188,812,800원 | `total-depositAmount` SSOT 사용 |
| R18-02 | KPI 미수 건수와 DB 술어 대조 | PASS · 7건 | 금액과 건수가 같은 모집단 사용 |
| R18-03 | 순이익 = 매출 - 비용 | PASS · 0 = 0 - 0 | 공급가 기준 일관성 확인 |
| R18-04 | 현금 잔액과 cashflow SSOT 대조 | PASS · 60,131,324원 | 제한 목록의 최근 행 대신 전체 forecast 집계 사용 |
| R18-05 | 월마감 요약과 KPI 대조 | PASS · 매출/비용/미수 일치 | 동일 서비스 계산 확인 |
| R18-06 | VAT 반기 원천 합계 대조 | PASS · 매입 12,090,000원, VAT 1,209,000원 | 환급 음수 보존 |
| R18-07 | 딜 손익 목록 조회 | PASS · 9행 | 발생주의 라벨 유지 |
| R18-08 | 구독 월환산 API와 화면 계약 | PASS · `{monthlyTotal:0,count:0}` | number 응답을 객체 계약으로 수정하고 회귀테스트 추가 |
| R18-09 | 잘못된 VAT 기수 | PASS(차단) · 400 | 내부 예외/원문 미노출 |
| R18-10 | 존재하지 않는 CFO 경로 | PASS(차단) · 404 `not_found` | 전역 인증 401로 오인되던 fall-through 차단 |

## R19 — 모바일·한국어·키보드

| ID | 사용자 시나리오 | 실행 결과 | 발견 및 개선 |
|---|---|---|---|
| R19-01 | 390px 고객 허브와 연락처 폼 | PASS · 실 Chromium | 세로 폼과 카드에 가로 잘림 없음 |
| R19-02 | 연락처/파트너 수정 버튼을 스크린리더로 구분 | PASS · 제목을 accessible name에 포함 | 동일한 `수정` 이름 중복 완화 |
| R19-03 | 작업 상세 상태·우선순위 읽기 | PASS · `할 일/진행 중`, `높음` | raw `todo/doing/high` 제거 |
| R19-04 | 딜 전환 오류와 force 키보드 진입 | PASS · button + 한국어 오류 | 명시적 confirm 유지 |
| R19-05 | 390px 갱신 카드와 단계 레일 | PASS · 실 Chromium | 단계 레일 가로 스크롤, 카드 wrap 추가 |
| R19-06 | 월마감 완료 버튼 비활성 이유 읽기 | PASS · `aria-describedby` + 가시 문구 | 미처리 항목 해결 안내 추가 |
| R19-07 | 390px VAT 기간 폼 | PASS · 실 Chromium | 연도·기수 label과 조회 버튼 확인 |
| R19-08 | CFO 대시보드 미수 설명 | PASS · `잔액 기준 전체` | 최근 200건 UI와 전체 KPI 의미 분리 |
| R19-09 | 구독 주기 읽기 | PASS · `매월/매년/매주` | raw cycle 제거 |
| R19-10 | 보관 실패 시 사용자 피드백 | PASS · `role=alert` | HTTP/네트워크 실패의 silent path 제거 |

## R20 — 동결 회귀 교차검증

| ID | 동결 시나리오 | 증거 | 판정 |
|---|---|---|---|
| R20-01 | 연락처 교정·보관·tenant 회귀 | contact route/business 테스트 + R16 실 API | PASS |
| R20-02 | 파트너 교정·tenant 회귀 | partner collection/detail 테스트 + 403 실 API | PASS |
| R20-03 | 작업 역방향·보관·한국어 회귀 | web 전체 테스트 + 상세 200 | PASS |
| R20-04 | 전환 409 안정 코드와 force 확인 | 실 API `conversion_requires_poc` + UI confirm | PASS |
| R20-05 | 갱신 상태·고객 링크·모바일 | PATCH 200 + Chromium 390px | PASS |
| R20-06 | 월마감 실행과 disabled 설명 | 시작 200, 미충족 완료 차단, 가시 설명 | PASS |
| R20-07 | VAT 기간 선택과 원천 수치 | 2025-2기 200 + SQL 대조 | PASS |
| R20-08 | CFO 미수금·현금 SSOT | SQL/API `188812800|7`, 현금 `60131324` | PASS |
| R20-09 | 구독 계약·한국어 | API 객체 계약 + unit test + 화면 라벨 | PASS |
| R20-10 | auth·unknown route·safe error | auth tests, CFO 404 test, client safe-error test | PASS |

## 변경 요약

- Contact에 교정/보관 모델·migration·business/API/UI를 추가했다.
- 파트너와 연락처의 프로젝트 범위를 요청 body가 아니라 서버 관계로 계산한다.
- 작업/고객/파트너/연락처의 destructive copy를 실제 soft archive 의미에 맞췄다.
- 딜 전환 실패를 안정 코드로 만들고 강제 전환을 별도 사용자 확인 뒤에만 허용한다.
- 월 마감 실행, VAT 기간 조회, 갱신 상태 변경을 실제 화면에서 도달 가능하게 했다.
- CFO 미수금·현금·구독 계약·오류 코드를 서버 SSOT와 일치시켰다.
- 모바일 갱신 레일, 한국어 상태, 비활성 사유, 보관 오류 알림을 보강했다.

## 잔여 위험

- 현재 웹 세션 역할은 `admin/operator/viewer` 중심이다. viewer의 CFO SSR 노출은 차단했지만 실제 조직용 `finance` 역할 발급·관리 모델은 별도 설계가 필요하다.
- `dashboard/project-pnl`과 `deals-pnl`은 서로 다른 엔티티 축이다. 이번 사용자 화면은 후자를 명시적으로 쓰지만 API 소비자는 축을 구분해야 한다.
- 메일 후보의 이름 자체를 승인 전에 고치는 흐름은 아직 없고, 유형 교정만 가능하다.
- 월 마감 완료는 체크리스트를 만족시키는 별도 업무가 선행되어야 하므로 이번 QA에서는 성공 완료 대신 안전 차단을 검증했다.
- 2026-07-13 23:44 KST에 남은 테스트 감사 로그 34행은 운영 삭제 승인이 필요하다. 대상은 세션 전 덤프와 행수/시간/`case_ref`를 대조해 특정했으며, 임의 삭제하지 않았다.

## 출하 판정

- 코드 회귀 매트릭스는 PASS다.
- 운영 동결은 **NO-RELEASE**다. 위 34개 테스트 감사 로그의 승인된 정리와 후속 운영 지문 재확인 전에는 배포하지 않는다.

## 최종 품질 게이트

- `pnpm lint`: exit 0. 기존 경고는 남아 있으나 오류는 0이다.
- `pnpm typecheck`: exit 0.
- `pnpm test`: exit 0. 주요 집계는 business 664 passed/41 skipped, web 175 passed/6 skipped, API 59 passed/23 skipped다.
- `NEXT_DIST_DIR=.next-uxtest-r20-final pnpm build`: exit 0, Next 72개 정적 페이지 생성 완료.
- `git diff --check`: exit 0.
- QA cleanup: 임시 DB 0개, Redis DB 14 key 0, QA web/API listener 종료.

## 증거 위치

- Grok 독립 검토: `.agents/coop/ux-round-16-grok.md` … `.agents/coop/ux-round-20-grok.md`
- 모바일 렌더: `/tmp/r19-{customer,renewals,month-close,vat}-mobile.png`
- 정식 migration: `packages/db/prisma/migrations/20260713143000_contact_corrections/migration.sql`
