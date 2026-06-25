# Data Governance

## 목적

이 문서는 어떤 데이터를 저장하고, 누가 보고, 언제 삭제하고, AI가 어디까지 사용할 수 있는지 정의한다.

## 데이터 분류

| Classification | 예시 | 기본 정책 |
|---|---|---|
| Public | 일반 제품 설명 | 자유 조회 |
| Internal | 업무 상태, 일반 템플릿 | 회사 내부 |
| Confidential | 제안서, 견적, 고객 요구사항 | 배정자 중심 |
| Restricted | 네트워크 구성, 보안 취약점, 장애 로그, 마진 | need-to-know |
| Regulated Personal Data | 이름, 이메일, 전화번호, 계정 | 개인정보 정책 적용 |

## Field-level Inventory

| Table/Field | Classification | Note |
|---|---|---|
| customers.primary_contact | Regulated Personal Data | masking 필요 |
| opportunities.pain_points | Confidential | 고객 문제 포함 |
| artifacts.body | Confidential/Restricted | artifact별 다름 |
| quotes.margin | Restricted | Finance/CEO 제한 |
| support_cases.logs | Restricted | 민감 로그 가능 |
| ai_prompts.input | Confidential/Restricted | 보존 기간 제한 |
| audit_logs.redacted_payload | Internal/Confidential | 원문 저장 금지 |

## Access Policy

```text
read != export
view != download
role != need-to-know
```

- Sales는 margin cost를 기본적으로 볼 수 없다.
- Presales는 해당 Opportunity에 배정된 경우 discovery를 볼 수 있다.
- Support는 affected asset이 연결된 case만 본다.
- Security Officer는 audit/security data를 보지만 business approval 권한은 별도다.

## Retention Policy 초안

| 데이터 | 기본 보존 |
|---|---|
| 미전환 Lead | 12개월 후 삭제/익명화 |
| Opportunity | 5년 |
| Quote/Proposal | 5~7년 |
| Customer Asset/License | 계약 종료 후 5년 |
| Support/RCA | 3~5년 |
| AI Prompt/Output | 90일~1년 |
| Audit Log | 7년 이상 또는 정책 기준 |
| 개인정보 | 목적 달성 시 삭제, 법정 보존 예외 |

## Data Subject Request

처리 절차:

1. 요청 접수
2. 본인/고객 확인
3. 데이터 위치 검색
4. 삭제/익명화 가능 여부 판단
5. legal hold 확인
6. 처리 결과 기록
7. audit log 보존

## AI 사용 정책

Restricted 데이터는 기본적으로 외부 LLM에 전송 금지. 허용하려면 다음이 필요하다.

- 승인된 LLM provider
- 데이터 마스킹
- prompt logging off 또는 redacted
- 고객/계약상 허용 여부 확인
- Security Officer 승인

## Backup Governance

- 백업 암호화
- 백업 접근 audit
- tenant 단위 restore 절차
- restore drill
- 로컬 다운로드 금지
- backup retention 별도 정책


## V3.1 보강 — Copy / Download / Export / Watermark 정책

### 권한 분리 원칙

```text
read/view 권한이 있어도 copy/download/export/share 권한은 자동 부여하지 않는다.
restricted artifact는 기본적으로 view-only이며, export는 별도 승인 대상이다.
```

| 행위 | 권한 | 감사 이벤트 | 추가 통제 |
|---|---|---|---|
| View | artifact.read | artifact_access_events.view | classification masking |
| Copy | artifact.copy | artifact_access_events.copy | restricted는 승인 필요 |
| Download | artifact.download | artifact_access_events.download | signed URL + 만료 |
| Export | artifact.export | data_export_requests + audit | 승인 workflow 필수 |
| Share | artifact.share | artifact_access_events.share | 외부 공유 승인 |
| Print | artifact.print | artifact_access_events.print | watermark 필수 |

### Restricted Artifact 화면 정책

Restricted 또는 Regulated Personal Data artifact는 기본적으로 다음 UI 통제를 적용한다.

```text
- 화면 watermark: 사용자명, 회사명, timestamp, request_id
- 민감 필드 기본 masking
- 다운로드 버튼 기본 비활성화
- 외부 공유 버튼 기본 비활성화
- 복사 시도 시 audit event 생성
- export 요청에는 사유 입력 필수
- 승인된 export link는 time-limited signed URL로 제공
```

### Data Export Request Workflow

```text
User requests export
 → classification check
 → need-to-know check
 → manager/security approval
 → time-limited export generated
 → download event logged
 → link expires
```

### 데이터 위치별 삭제/익명화 체크리스트

고객 삭제/익명화 요청은 다음 저장소 전체를 대상으로 수행한다.

```text
customers
opportunities
artifacts / artifact_versions
artifact_access_events
quotes / quote_line_items
support_cases / RCA
customer_assets / subscriptions
ai_prompt_runs
ai_quality_results
audit_logs.redacted_payload
backups / archives
```

감사 로그는 원칙적으로 삭제하지 않고, 개인 식별 가능 payload는 redacted 또는 keyed pseudonym 형태로 유지한다.

### 퇴사/부서 이동 데이터 Owner 이관

```text
퇴사 또는 부서 이동 발생
 → user_company_roles revoke
 → open opportunity owner 재배정
 → pending approval 재배정
 → renewal owner 재배정
 → support case owner 재배정
 → audit event 기록
```
