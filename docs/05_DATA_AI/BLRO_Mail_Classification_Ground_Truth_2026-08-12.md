# BLRO 메일 분류 Ground Truth 분석

> 상태: **사용자 검토용 초안**
>
> 분석일: 2026-08-12  
> 원본 위치: MacBook `~/Documents/개인자료/법인 - 베를로/` 및 `~/Downloads/`  
> 안전 경계: 이 분석에서는 운영 DB, `PolicyMemory`, 메일 후보를 변경하지 않았다.

## 1. 목적

메일 자체에서 정답을 추측하지 않고, 프로젝트 폴더·매출/매입 세금계산서·통장 거래·
영업/리뉴얼 원장을 먼저 회사의 확정 자료로 만든다. 그 자료로 기존 메일을 다시
분류한 후, 사용자의 승인 표본이 쌓이면 기존 `AutonomyPolicy`를 통해
`observe → suggest → auto` 순서로 권한을 높인다.

## 2. 조사 범위

| 자료 | 조사 범위 |
|---|---:|
| 프로젝트 폴더 | 5.9GB, 파일 90,827개, 디렉터리 9,292개 |
| 실제 프로젝트 폴더 | 활성 19, 완료 9, 연기 6, 실패 3 |
| 기타 업무 상태 | 리뉴얼 10개 항목, 기술지원 7개 항목 |
| 세금계산서 매출처별 명세 | 4개 파일, 매출처 14개 |
| 매입 세금계산서 | 4개 파일, 17건 |
| 은행 거래내역 | 2개 파일 |
| 보조 원장 | `2026 BLRO Korea Sales Funnel`, `Sangfor Renewal 2025` |

프로젝트 폴더의 90,827개 파일 중 다수는 복사된 개발 소스와 패키지 파일이었다.
영업 사실 자료는 견적서·최종 PDF·발주서·계약서·세금계산서·작업/납품 문서로
한정해야 한다.

## 3. 핵심 결론: 회사 유형이 아니라 프로젝트별 역할 그래프

하나의 회사를 영구적으로 `customer` 또는 `partner` 하나로 고정하면 안 된다.
실제 거래는 다음과 같은 그래프다.

```text
제조사/공급사 → BLRO → 매출처/채널 파트너 → 최종 고객
                     ↘ 직접 최종 고객
```

확인된 예:

| 공급사 | BLRO 매출처/채널 | 최종 고객/프로젝트 | 근거 |
|---|---|---|---|
| 넥시아스 | 제이앤지시스템 | 인카금융서비스 | 매입 비고 + 매출 세금계산서 + 입금 |
| 넥시아스 | GSITM | GS E&C/GS건설 DT | 매입 비고 + 매출 세금계산서 + 입금 + 리뉴얼 원장 |
| 넥시아스 | 디지틀조선일보 | 게임조선 | 매입 비고 + 매출 세금계산서 + 입금 + 발주서 |
| HC코퍼레이션 | 미확정 | 동국대병원 VDI | 매입 품목 + 프로젝트 폴더 |
| BLRO | 일에이엔 | 한라IMS·아이센스·덕산홀딩스 등 | 최종 PDF 수신처 + 프로젝트 폴더 |

따라서 학습 레코드는 최소한 다음을 가진 **관계 레코드**여야 한다.

```text
project
subject_entity
role_in_project
counterparty
end_customer
product
lifecycle
source_artifact
evidence_tier
confidence
valid_from / valid_to
review_status
```

## 4. 증거 우선순위

| 등급 | 자료 | 시스템 처리 |
|---|---|---|
| A | 세금계산서 총액과 통장 입출금이 일치 | 확정 거래 관계 |
| A | 매입 세금계산서와 공급사 출금이 일치 | 확정 공급사 관계 |
| B | 세금계산서만 존재 | 법적 거래 상대는 확정, 결제 상태는 미확정 |
| B | 매입 세금계산서 비고/품목의 최종 고객 | 프로젝트 연결 근거 |
| C | 상태 폴더 + 프로젝트명 + 최종 PDF 수신처 | 프로젝트 역할 후보 |
| D | 메일 분류 결과 | 사용자 승인 전 제안 |
| 제외 | 템플릿, `~$` 잠금 파일, 복사 시트, 깨진 `#REF!` 시트 | 학습 금지 |

`최종 PDF > 파일명과 일치하는 활성 엑셀 시트 > 나머지 시트` 순서로 신뢰한다.

## 5. 재무자료 교차검증

### 5.1 매출 세금계산서와 입금이 정확히 일치

| 매출처 | 확인 금액(부가세 포함) | 판정 |
|---|---:|---|
| 제이앤지시스템 | 83,490,000원 | 큰 세금계산서 1건과 입금 정확히 일치 |
| 브이씨링크 | 3,300,000원 | 정확히 일치 |
| 에이아이티 | 3,300,000원 | 정확히 일치 |
| 두올테크 | 1,870,000원 | 정확히 일치 |
| 이너엔 | 1,100,000원 | 정확히 일치 |
| 롯데건설 | 550,000원 | 정확히 일치 |

### 5.2 일부 입금 또는 조사 기간 밖

| 매출처 | 세금계산서 합계 | 확인 입금 | 상태 |
|---|---:|---:|---|
| 디지틀조선일보 | 6,270,000원 | 2,640,000원 | 한 건 일치, 나머지 미확인 |
| 굿어스 | 8,008,000원 | 4,664,000원 | 반복 부분입금 |
| 투비컴텍 | 18,772,600원 | 8,045,400원 | 일부 입금 |
| GSITM | 15,400,000원 | 17,996,000원 | 조회한 명세보다 2,596,000원 많음 |
| 아지텍 | 119,380,800원 | 없음 | 해당 은행 조회 기간에서 미확인 |
| 일에이엔 | 7,700,000원 | 없음 | 해당 은행 조회 기간에서 미확인 |
| 지티솔루션 | 2,200,000원 | 없음 | 해당 은행 조회 기간에서 미확인 |

입금이 없다는 사실은 `미수` 또는 `비고객`을 뜻하지 않는다. 두 은행 파일이 전체
기간을 포함하지 않으므로 `해당 조회 기간에서 미확인`으로만 기록한다.

### 5.3 공급사

| 공급사 | 매입 공급가 | 추가 확인 |
|---|---:|---|
| 넥시아스 | 164,740,000원 | 출금 12,100,500원 확인, 다수 최종 고객 비고 존재 |
| HC코퍼레이션 | 11,000,000원 | 출금 12,100,500원, 세금계산서 총액 12,100,000원 |
| 이루인포 | 1,322,000원 | 상포테크놀로지/대아건설 품목 |
| 한국정보인증 | 100,000원 | 법인 인증서 |
| 더존비즈온 | 30,000원 | WEHAGO |

## 6. 프로젝트 상태

### 완료

인카금융 aSV, 롯데건설 리뉴얼, 조선일보그룹 리뉴얼, KV메트리얼즈 IAG 리뉴얼,
UNID 리뉴얼, KB손해사정 서버가상화, 부산도시가스공사 hDR, GS건설 VDI 리뉴얼,
게임조선 리뉴얼.

### 연기

HC코퍼레이션 구매, TYM HCI, 금강철강 DR, 한국항공공사,
대통령경호처 HCI, 에스씨엘사이언스 서버/NGAF.

### 실패

| 폴더의 최종 고객 | 제품 | 실제 견적 수신처 | 판정 |
|---|---|---|---|
| 휠라코리아 | SASE | 에스지나인 조남일 이사 | `휠라코리아=end customer`, `SG나인=채널 후보` |
| 에스지나인 | IAG | 에스지나인 조남일 이사 | SG나인 자체 기회 또는 미기재 최종고객 |
| 한라IMS | SASE | 일에이엔 윤동원 팀장 | `한라IMS=end customer`, `일에이엔=채널` |

실패 폴더는 `고객 아님`을 의미하지 않는다. **실패한 opportunity**라는 뜻이며,
향후 메일에서 해당 회사가 다시 등장하면 과거 실패 이력을 함께 제시해야 한다.

### 활성 19건

동국대학교 VDI, GS건설 WANO/IAG 교체, 일지테크 Total infra,
GS건설 DT VDI, 선진엔지니어링 HCI, 포스코건설 VDI,
효성TNS 인도 HCI, 서울도시가스 HCI, KTIS aSV Ent, MSE,
미래에셋자산운용 aSV Ent, 범한 HCI/DR, 이레IDS VDI,
일지테크 2공장 Total infra, 성우하이텍 HCI/hDR,
덕산홀딩스 aSV Ent, 게임조선 HCI 3노드, 아이센스 aSV Ent, 넥스이노.

루트에 있다는 이유만으로 `active`라고 단정하지 않고 `active_candidate`로 기록한다.

## 7. 자동학습에 넣으면 안 되는 오염

1. 한 견적 엑셀 안에 GSITM·GS건설·아지텍 등 과거 템플릿 시트가 모두
   `visible`로 남아 있다. 전 시트를 읽으면 존재하지 않는 고객관계를 만든다.
2. 파일의 활성 시트도 항상 정답은 아니다. 최종 PDF와 파일명/프로젝트 문맥이
   일치할 때만 사용한다.
3. `Sales Funnel` 원장은 오래된 연도 시트와 현재 데이터가 섞여 있고 `Source`
   시트는 `#REF!`가 깨져 있다. 파트너/고객 관계의 보조 근거로만 쓴다.
4. `더존비즈온` 33,000원이 매출과 매입 양쪽에 동일하게 존재한다. 반대 방향
   발행 또는 다운로드 구분 오류인지 사람 확인 전까지 격리한다.
5. 디지털조선/디지틀조선/디지탈조선, KV메트리얼즈/KV Materials,
   Incar/인카금융서비스 등은 사업자번호 또는 승인된 alias로 묶어야 한다.

## 8. 기존 자율운영 정책과의 정합성

이미 스키마에 요구사항이 있다.

- `AutonomyPolicy.minSamples = 10`
- `AutonomyPolicy.minAutonomy = 0.9`
- `requireColorGatePass = true`
- 초기 시드는 모든 도메인을 `observe`로 시작
- 최근 AI 결정 3건이 연속으로 사람에게 뒤집히면 `auto → suggest` 강등

관련 코드:

- `packages/db/prisma/schema.prisma:4378`
- `packages/business/src/orchestration/autonomy-policy.ts:64`
- `packages/business/src/orchestration/autopilot.ts:96`
- `packages/business/src/orchestration/autopilot.ts:190`
- `packages/db/prisma/seed.ts:151`

조사 당시에는 시드의 `mail_candidate_approve`와 실제 autopilot 조회·강등의
`autopilot_approve`가 달랐다. 이 변경에서는 시드와 런타임을
`autopilot_approve`로 통일하고,
`20260812190000_unify_autopilot_policy_key` 마이그레이션으로 기존 legacy 행을
충돌 없이 병합하도록 했다. 마이그레이션 파일은 구현됐지만 아직 운영 DB에
배포하지 않았다.

현재 러너는 `auto` 조건을 만족해도 인증된 CRM `AuthContext`가 없으면 실제
승인하지 않고 review draft로 남긴다. 이는 사용자 승인 기반 운영과 맞지만,
UI에서는 “auto 조건 충족”과 “실제 자동 처리됨”을 구분해야 한다.

## 9. 권장 최종 학습 순서

```text
1. 확정자료 수집
   ↓
2. 법인 alias + 프로젝트별 역할 그래프 생성
   ↓
3. 기존 메일 전체 재분류
   ↓
4. 사용자 승인/수정
   ↓
5. 같은 결정 유형별 표본 10건 + 승인 일치율 90% + color gate
   ↓
6. suggest 모드에서 AI와 공동 처리
   ↓
7. 명시적 정책 승격 후에만 reversible auto
   ↓
8. 연속 3회 뒤집힘 또는 근거 충돌 시 suggest로 자동 강등
```

표본은 전체 메일 수가 아니라 `고객 식별`, `파트너 식별`, `시스템 메일`,
`프로젝트 상태`, `매입/매출 연결` 같은 **결정 유형별 표본**으로 계산해야 한다.

## 10. 구현 및 운영 절차

사용자가 2026-08-12에 권장 기본 승인안과 1~3단계 구현을 승인했다.

구현 산출물:

- 승인 manifest:
  `BLRO_Mail_Classification_Ground_Truth_2026-08-12.json`
- 프로젝트 역할 메모리 파서·import 계획:
  `packages/business/src/mail/mail-ground-truth*.ts`
- 정책 키 통합:
  `autopilot_approve`
- no-write 재분류 명령:
  `pnpm --filter @sangfor/business mail-ground-truth:dry-run`

이 JSON은 전체 메일 분류 corpus의 정본이 아니라, 근거 파일과 관계를 사람이
검토·승인한 **bootstrap 부분집합**이다. 이후 재분류 결과는 별도 사람 승인 없이는
이 manifest나 운영 레코드에 자동 승격하지 않는다.

파일로 내보낸 후보를 검토할 때:

```bash
pnpm --filter @sangfor/business mail-ground-truth:dry-run -- \
  --candidates /path/to/mail-candidates.json
```

개발 DB에 직접 연결할 수 있는 환경에서 프로젝트 범위를 강제해 조회할 때:

```bash
DATABASE_URL=... pnpm --filter @sangfor/business mail-ground-truth:dry-run -- \
  --project-id <project-id>
```

출력의 `changes`는 제안 변경표, `humanReview`는 역할 충돌로 사람이 결정해야 할
항목, `writeOperationsPrevented`는 dry-run이 막은 쓰기 수다. 명령은
`MailDerivedCandidate`를 갱신하지 않는다. 운영 적용은 이 변경표를 사용자가 다시
승인한 뒤 별도 승인 게이트에서 수행해야 한다.

### 10.1 검토 화면

인증된 메일 후보 상세 화면
`/approvals/mail-candidates/<candidate-id>`은 같은 production planner를 사용한
**근거 대장 대조 (읽기 전용)** 카드를 표시한다.

- 후보 조회, 대장 preview, 후보 목록은 로그인 세션에서 서버가 계산한
  tenant/company/project `AuthContext`와 DB RLS transaction을 사용한다.
- 클라이언트 query/body의 tenant/company/project 값은 신뢰하지 않는다.
- 카드는 현재 유형과 제안 유형, 프로젝트 관계, evidence tier,
  `sourceArtifactIds`, 충돌 여부를 보여준다.
- `scanned`, `writeOperationsPrevented`, `writesPerformed`를 production planner
  결과 그대로 표시하며, preview의 `writesPerformed`는 항상 `0`이다.
- preview에는 적용 버튼이 없다. 기존 유형 전환과 승인/연결 동작만 사람의 명시적
  선택으로 실행된다.
- `GET /api/mail-candidates/<candidate-id>?preview=ground_truth`는 같은 scoped
  preview를 `Cache-Control: no-store`로 반환한다. 알 수 없는 preview 값은
  `422`, 인증 실패는 `401/403`, 범위 밖 후보는 opaque `404`로 닫힌다.

운영 DB migration 적용, 전체 corpus 승격, 일괄 재분류 쓰기는 여전히 별도 승인
대상이며 이 구현에서 실행하지 않았다.

### 10.2 2026-08-12 dry-run 결과

2026-08-12 운영 연결을 사용한 no-write 실행에서는 578개 후보를 읽었고 DB 쓰기는
0건이었다. 아래 표는 같은 manifest와 production planner를 고정된 3개 fixture에
적용한 재현 가능한 QA 결과다. 두 실행 모두 후보나 PolicyMemory를 변경하지 않았다.

동일한 manifest와 production 함수를 사용한 대표 후보 QA 결과:

| 후보 | 기존 | 제안 | 근거 |
|---|---|---|---|
| GSITM / GS건설 DT VDI | customer | partner | `gsenc-dt:gsitm:channel` |
| 일에이엔 / 한라IMS SASE | customer | partner | `halla-ims-sase:ilaen:channel` |
| Bill36524 세금계산서 알림 | customer | 유지 | 시스템 발신자 보호 |

`scanned=3`, `changes=2`, `writeOperationsPrevented=2`였고 DB 쓰기는 0건이었다.

