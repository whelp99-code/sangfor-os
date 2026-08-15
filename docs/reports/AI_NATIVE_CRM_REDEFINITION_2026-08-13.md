# BLRO CRM, 다시 중심을 잡다

> 고객을 홈으로, 업무를 실행 단위로, 파이프라인을 영업 관측 뷰로,  
> 게이트를 위험 통제로, AI를 권한 있는 동료로 둔다.

- 작성일: 2026-08-13
- 코드 관찰 기준: `feat/mail-candidate-triage` · `3089bc14eed5aeb2a7567ca614a64262257004df` 위의 공유 작업 트리
- 범위: 현재 Sangfor OS 코드·기획 문서, 주요 상용·오픈소스 CRM, AI-native 업무 설계
- 산출물: 이 Markdown 원문 + 동일 주장 집합의 독립형 HTML
- 이 문서의 목적: 구현 계획을 바로 확정하는 것이 아니라, **우리가 어떤 제품을 만들고 있는지 다시 합의하는 것**

---

## 0. 이 문서가 바꾸는 기존 정본

기존 `DESIGN.md:10`과 `.design-context.md:6`은 제품을
“CRM이 아니라 감독형 AI 오퍼레이션 콘솔/관제탑”이라고 정의한다. 당시에는 일반 CRM과
다른 감독·승인·학습 경험을 강조하기 위한 표현이었다.

2026-08-13 사용자가 다시 밝힌 의도는 더 넓고 명확하다.

> 여러 CRM의 장점을 하나로 모으고, 대표·사람 직원·AI 직원이 영업·프리세일즈·엔지니어링·
> 지원·수주·재무를 함께 처리하는 최종 CRM을 만든다.

따라서 이 보고서는 제품 명칭과 관계를 다음처럼 결정한다.

- **제품 범주:** AI-native 회사 운영 CRM
- **전체 제품명:** **BLRO OS**
- **관제탑:** 제품 전체 범주가 아니라 사람의 승인·감독 경험을 가리키는 UX 원칙이다.
- **CRM:** 영업 화면 하나가 아니라 고객·관계·업무·프로젝트·지원·리뉴얼·재무를 연결하는
  운영 데이터와 협업 계층이다.

이 결정은 이전의 “CRM이 아니다” 문구를 **대체한다**. 후속 구현 전에 `DESIGN.md`,
`.design-context.md`, `docs/01_SPEC`의 External CRM 표현, 요구사항 registry의 제품 범주를
같은 정의로 고쳐야 한다. 이 보고서 자체는 아직 분석 산출물이므로, 그 정본 수정이 끝나기
전에는 구현자가 과거 문구를 따라갈 위험이 남는다.

---

## 1. 한 장 결론

### 원래 만들려던 것

우리가 만들려던 것은 영업기회를 단계별로 넘기는 도구 하나가 아니다.

**대표, 사람 직원, 역할별 AI 직원이 같은 고객과 같은 업무 맥락을 보면서
영업·프리세일즈·구축·기술지원·수주·리뉴얼·재무 업무를 함께 처리하는
AI-native 회사 운영 CRM**이다.

사용자는 다음처럼 짧게 말할 수 있어야 한다.

> 케이브이머티리얼즈 / HCI / 2027-04-30 / 21백만원

시스템은 이 말을 듣고 사용자를 DB 구조로 밀어 넣는 대신 다음을 해야 한다.

1. 케이브이머티리얼즈와 관련된 고객·딜·메일·자산 후보를 찾는다.
2. 의도를 `HCI 리뉴얼`로 분류한다.
3. 만료일 `2027-04-30`, 예상 금액 `21,000,000원`을 구조화한다.
4. 기존 고객·자산과 연결할지, 누락된 고객/자산을 함께 만들지 제안한다.
5. D-120/D-90 업무와 담당 AI·사람을 제안한다.
6. 사용자가 **한 번 확인**하면 기존 도메인 서비스로 안전하게 기록한다.

### 현재 실제 모습

현재 시스템은 전부 선형인 것은 아니다.

- PoC는 영업기회 없이 만들 수 있다.
- 작업도 다른 객체 없이 만들 수 있다.
- 고객·딜·자산·지원·리뉴얼·승인·감사 모델은 이미 상당히 풍부하다.

그러나 기능마다 시작 방식이 서로 다르다.

- 딜은 직접 만들 수 있지만 다음 단계로 가려면 BANT·등록 조건을 알아야 한다.
- 구축 프로젝트는 영업기회를 특정 단계까지 올리고 PoC를 연결한 뒤
  `프로젝트로 전환`해야만 생긴다.
- PoC는 독립 생성 가능하지만 메뉴가 깊고 딜에서 만들면 자동 연결이 약하다.
- 기술지원은 생성 API가 있지만 화면에 등록 버튼이 없다.
- 리뉴얼은 수동 등록이 없고 투영 함수·operator 경로에만 의존한다.
  recurring production schedule은 이번 정적 조사에서 증명되지 않았다.
- AI 어시스턴트는 실제 업무 생성보다 별도 명령·대시보드·장식성 제안에 가깝다.

정확한 진단은 **“모든 것이 한 프로세스에 잠겼다”가 아니라
“업무마다 서로 다른 생성 문법과 연결 규칙이 있고, AI가 이를 하나의 업무 접수 체계로
통합하지 못했다”**이다.

### 목표 모습

```text
사용자·메일·시스템 이벤트
          │
          ▼
      통합 업무 접수
          │
          ▼
  의도·고객·관계·누락값 해석
          │
          ▼
      실행 제안서 초안
          │
   ┌──────┼────────┐
   ▼      ▼        ▼
사람 확인  권한/위험  AI·컬러 검토
   └──────┼────────┘
          ▼
   기존 도메인 서비스 실행
          │
 ┌────────┼─────────┬─────────┬─────────┐
 ▼        ▼         ▼         ▼         ▼
 딜       PoC      프로젝트    지원      리뉴얼
 └────────┴─────────┴─────────┴─────────┘
          │
       고객 맥락
          │
    감사 · 결정 · 결과
          │
          ▼
  학습 후보 · 평가 · 사람 승인
          │
          └──── 다음 관찰·제안으로 되돌아감
```

**파이프라인은 없어지지 않는다.** 다만 영업기회에만 적용되는 예측·자격검증·상업 통제
뷰가 된다. 기술지원·리뉴얼·PoC·구축 프로젝트를 태어나게 하는 상위 부모가 아니다.

---

## 2. 우리가 다시 잠가야 할 제품 원칙

### 원칙 1. 고객은 데이터와 협업의 척추다

기존 초기 설계도 “고객사 = 척추”를 명시했다
(`.design-context.md:19-24`). 고객 화면에서는 연락처만 보여주는 것이 아니라 현재 진행 중인:

- 딜
- PoC
- 구축 프로젝트
- 보유 자산·구독
- 기술지원
- 리뉴얼
- 견적·재무 연결
- 작업·승인·AI 제안

을 함께 볼 수 있어야 한다.

### 원칙 2. 업무는 사실이 발생한 곳에서 바로 시작한다

| 업무 | 자연스러운 시작 신호 | 시작할 때 요구하면 안 되는 것 |
|---|---|---|
| 신규 영업 | 문의, 메일, 소개, 견적 요청 | PoC·프로젝트 |
| 구축 프로젝트 | 계약, SOW, 설치 요청, 내부 이행 | 영업 전 단계를 억지로 밟기 |
| PoC | 기술 검증 필요 | 딜 단계가 `POC`일 것 |
| 기술지원 | 장애·문의·파트너 요청 | 영업기회 |
| 리뉴얼 | 만료일·자산·구독·사람의 메모 | 신규 영업 파이프라인 |

링크는 중요하지만 **생성의 필수 부모**가 되어서는 안 된다.

### 원칙 3. 프로세스는 터널이 아니라 가드레일이다

모든 행동을 자유롭게 하자는 뜻이 아니다.

- 내부 메모·작업·초안·PoC 생성: 자유롭고 되돌릴 수 있어야 한다.
- 딜 단계 전진: BANT·등록과 같은 증거 조건을 유지한다.
- 견적 외부 발송·저마진·계약·수주 선언: 상업 승인을 유지한다.
- 자산 생성: 납품 검수와 연결된 통제를 유지한다.
- 외부 메일·삭제·내보내기·배포: 사람 승인을 유지한다.
- AI의 불명확하거나 고위험한 실행: 자동 실행하지 않는다.

즉, **업무의 탄생**과 **위험한 약속·변경**을 분리한다.

### 원칙 4. AI는 화면 옆 조언자가 아니라 업무 계약을 가진 직원이다

역할 AI는 다음 계약을 공통으로 가져야 한다.

1. 실제 고객·업무를 `caseRef`로 받는다.
2. 세션에서 계산된 권한 안에서만 읽고 제안한다.
3. 자연어를 바로 기록하지 않고 구조화된 실행 제안서를 만든다.
4. 어떤 레코드가 생성·수정되는지, 누락값이 무엇인지 보여준다.
5. 위험도와 자율성 정책에 따라 사람 확인 또는 정책 위임을 거친다.
6. 기존 비즈니스 서비스로만 실행한다.
7. 실행·거절·사람 수정 내용을 감사와 학습 기록으로 남긴다.

### 원칙 5. 유연한 UX와 무규칙 데이터는 다르다

Salesforce·HubSpot·Dynamics·Twenty도 표준 객체 외 업무를 모델링할 수 있지만,
객체·필드·관계·권한·워크플로는 여전히 명시적이다.

우리는 다음 극단을 모두 피해야 한다.

- 모든 업무를 영업기회 단계에 넣는 것
- 반대로 모든 사용자가 임의 필드와 임의 상태를 만드는 것

고객·딜·PoC·프로젝트·지원·리뉴얼은 **서로 다른 typed domain object**로 유지한다.
통합은 하나의 거대한 테이블이 아니라 고객 맥락, 작업, 관계, 통합 접수, 결정·감사에서 한다.

---

## 3. 현재 제품을 정확히 해부하면

### 3.1 데이터 모델은 생각보다 준비되어 있다

| 객체 | 현재 역량 | 판단 |
|---|---|---|
| Customer | 연락처·파트너·딜·PoC·자산·리뉴얼·지원·작업 관계 | 유지, 제품의 홈으로 승격 |
| Opportunity | 7단계, BANT, 등록, 견적, 이력, 프로젝트 전환 | 영업 전용 파이프라인으로 유지 |
| PocProject | 고객·파트너·영업기회가 모두 선택사항 | 독립 생성 역량 유지 |
| WorkTask | 고객·파트너·PoC·영업기회·메일 등과 선택 연결 | 공통 실행 단위로 승격 |
| Engagement | 구축 프로젝트지만 영업기회 1:1 전환으로만 생성 | 독립 생성 가능하도록 개편 |
| CustomerAsset | 납품 검수 후 생성 | 설치 자산의 진실로 유지, 보완 입력 검토 |
| SupportCase | 자산·담당·SLA와 연결된 상태 전이 | 통제 유지, 사람용 생성 화면 추가 |
| RenewalOpportunity | 독립 수명주기와 알림 이벤트 보유 | 수동/AI 접수 추가, 투영 로직 수정 |
| Quote/Finance | 서버 계산·상업 통제·Engagement 연결 | 반드시 유지 |
| Approval/Audit/Decision | CAS 승인·감사·AI 결정·자율성 정책 | 핵심 경쟁력으로 유지 |

근거: `packages/db/prisma/schema.prisma:894-1215`,
`packages/db/prisma/schema.prisma:2486-2787`,
`packages/db/prisma/schema.prisma:3708-3836`.

### 3.2 현재 다섯 사용자 여정

아래 숫자는 사용자를 대상으로 측정한 UX 점수가 아니다.
각 여정의 **생성 경로 존재 여부, 필수 화면 전환, 숨은 전제조건, UI/API 불일치**를
1~10으로 정리한 연구자 휴리스틱 심각도다. 비교 우선순위에는 쓸 수 있지만 실제 사용성
지표로 인용해서는 안 된다.

#### A. 신규 영업 — 휴리스틱 심각도 7.5/10

현재 좋은 점:

- `/deals`에서 새 딜을 만들 수 있다.
- 고객·파트너·금액은 선택값이고 처음에는 `LEAD`다.
- BANT, 등록, 단계 순서가 영업 품질을 지킨다.

현재 문제:

- 기본 `작업` 탭에서 다음 단계로 가려다가 BANT가 `상세` 탭에 있다는 사실을 뒤늦게 안다.
- 화면은 6개 작업 단계를 보여주지만 DB는 7단계여서 용어가 겹친다.
- 딜 화면의 `AI 거들기`는 실제 생성·수정 서비스와 연결되지 않은 정적 제안이다.
- 메일 후보는 실제 AI 인입에 가깝지만 별도 메뉴에 있다.

근거: `apps/web/src/components/deals/deals-workspace.tsx:196-284`,
`packages/business/src/crm/opportunity-stage.ts:279-370`,
`apps/web/src/components/deals/deal-ai-rail.tsx:1-75`.

#### B. 독립 구축 프로젝트 — 휴리스틱 심각도 9/10

현재 `/projects`는 `Engagement`만 보여준다. 새 프로젝트 버튼은 없다.
빈 화면도 “영업기회에서 프로젝트로 전환”하라고 안내한다
(`apps/web/src/app/(portal)/projects/page.tsx:29-44`).

유일한 생성 경로는:

1. 영업기회를 만든다.
2. `PROPOSAL` 이후 단계까지 간다.
3. PoC를 연결한다.
4. `프로젝트로 전환`한다.

서버도 같은 조건을 강제한다
(`packages/business/src/crm/opportunity-center.ts:977-1017`).

이 규칙은 “딜의 모든 자료를 구축 프로젝트로 흡수”할 때는 유용하다.
하지만 이미 합의된 구축, 내부 이행, 단순 재판매 설치처럼 딜 파이프라인이 필요 없는 업무의
생성 규칙으로는 잘못되었다.

또한 `Project`는 테넌트 워크스페이스, `Engagement`는 구축 프로젝트,
`FinanceProject`는 재무 프로젝트라 같은 단어가 세 객체를 가리킨다.

#### C. PoC — 휴리스틱 심각도 5.5/10

PoC는 이미 독립 생성이 가능하다.

- `opportunityId`는 선택값이다.
- 딜 단계가 `POC`가 아니어도 만들 수 있다.
- 독립 `/poc` 화면과 생성 폼이 있다.

근거: `packages/business/src/crm/poc-center.ts:50-170`,
`apps/web/src/components/poc/create-poc-form.tsx:49-64`.

문제는 기능 부재가 아니라:

- `더보기` 아래에 숨어 있고
- 딜에서 PoC를 눌러도 해당 딜이 자동으로 채워지지 않으며
- 나중에 프로젝트로 전환하려면 다시 링크를 맞춰야 한다는 것

이다. 이것은 **좋은 도메인 모델과 나쁜 제품 연결의 대표 사례**다.

#### D. 기술지원 — 휴리스틱 심각도 8.0/10

지원 생성 API는 존재하고 자산·담당·심각도·SLA 정책을 검증한다.
자산과 SLA는 설치 기반 지원의 합리적인 통제다
(`packages/business/src/support/support-service.ts:26-111`).

하지만 `/support`에는 등록 화면이 없다. 빈 화면은 파트너 요청이 들어오면 생긴다고
말하지만 실제 사람용 인입 경로를 찾을 수 없다
(`apps/web/src/app/(portal)/support/page.tsx:23-65`).

또 UI는 설치지원 5단계를 보여준다. 현재 canonical support-service 전이는
`open → in_progress → resolved`지만 DB 필드는 자유형 문자열이고, UI는 여러 legacy
상태를 5개 설치지원 컬럼으로 투영한다. 화면의 언어와 도메인 서비스의 진실이 다르다.

#### E. 리뉴얼 — 휴리스틱 심각도 8.5/10

리뉴얼은 완전히 수동인 것도, 완전히 자동인 것도 아니다.

- D-90/60/30 투영 함수와 privileged operator 실행 경로는 존재한다.
- 리뉴얼 자체의 상태 수명주기도 존재한다.
- `/renewals`는 레이더와 상태 변경을 보여준다.

그러나:

- 수동 등록 API·화면이 없다.
- 투영 배치는 구독 종료일만 보고 자산 만료 레이더와 분리되어 있다.
- 생성 시 금액 `10000`, 임의 첫 영업기회, `"p1"`·`"c1"` 같은 대체값을 사용한다.
- 배치가 쓰는 날짜와 UI가 읽는 날짜가 달라 생성된 건이 화면에서 보이지 않을 수 있다.

근거: `packages/business/src/support/renewal-projection.ts:54-223`,
`apps/web/src/app/(portal)/renewals/page.tsx:18-171`.

제공된 대화 사례에서 시스템은 케이브이머티리얼즈 정보를 받은 뒤 “고객부터 따로 만들고
운영 DB 승인을 달라”고 되물었다. 현재의 분절된 생성 경로와 일치하는 현상이지만,
대화 사례와 코드만으로 이 응답의 직접 인과를 증명할 수는 없다.

### 3.3 AI와 기획 자산의 현실

초기 설계에는 다음 핵심 루프가 명시되어 있다.

```text
역할 AI 초안 → 5색 검증 → 사람 승인·수정 → 학습
```

(`.design-context.md:19-24`)

코드에는 실제로:

- 도메인 AI 런타임
- 도메인 메모리
- 인간 결정 기록
- 컬러 에이전트
- 승인 커널
- 자율성 정책
- 감사 체인

이 있다.

그러나 `runDomainPipeline`은 테스트·스크립트에서만 실행되고 운영 HTTP 경로는 대시보드
조회에 그친다. `VerificationConsole`도 제품 화면이 아니라 테스트·디자인 계약에만 사용된다.
`OpportunityStageEvent` 역시 기록은 되지만 학습 소비자가 없다.

근거: `packages/business/src/domain-ai/domain-agent-runtime.ts:245-260`,
`apps/web/src/components/cockpit/verification-console.tsx:19-23`,
`packages/business/src/crm/opportunity-center.ts:644-782`.

결론은 **AI 자산이 없는 것이 아니라, 실제 고객·업무 생성 경로에 연결되지 않았다**는 것이다.

---

## 4. 왜 이렇게 되었나

### 4.1 잘못된 구현 하나가 아니라 여러 시기의 중심축이 겹쳤다

문서와 코드에는 최소 세 가지 제품 중심축이 함께 남아 있다.

1. **영업 파이프라인 중심**  
   7단계 영업기회, CFO 예측, 단계 이벤트
2. **감독형 AI 관제탑 중심**  
   역할 AI, 5색 검증, 사람 승인·학습
3. **도메인 회사 운영체제 중심**  
   영업·프리세일즈·엔지니어·CFO 종축 파이프라인

7단계 enum 보존은 실수만은 아니다. 기존 데이터, CFO 예측, 단계 이력을 보호하려는 의도적
결정이었다
(`docs/superpowers/specs/2026-06-30-deal-workspace-hub-design.md:96-104`).

문제는 enum을 보존한 것이 아니라 **그 enum이 화면과 업무 생성의 중심이 된 것**이다.
데이터 호환성과 제품 중심축은 같은 문제가 아니다.

### 4.2 실제 기능을 세로로 만들고, 공통 시작점을 만들지 않았다

각 도메인은 자신만의:

- 모델
- API
- 화면
- 상태
- 검증

을 가졌다. 그러나 사람이 “지금 해야 할 일”을 말하면 어떤 도메인으로 보내고 어떤 관계를
맺을지 결정하는 공통 계층이 없다.

그 결과 AI도 사용자의 의도를 해결하지 않고 “리뉴얼 레코드를 만들려면 고객과 자산이
필요하다”는 내부 구조를 설명하게 된다.

### 4.3 프로세스와 권한을 생성 전제조건으로 혼동했다

BANT·등록·PoC·상업 승인 같은 규칙은 위험한 영업 약속을 보호한다.
하지만 이 규칙을 프로젝트·업무의 존재 조건으로 확장하면 현실에서 이미 발생한 일을 시스템에
기록하지 못한다.

**기록할 수 있어야 통제할 수 있다.** 업무를 만들지 못하게 하는 것은 통제가 아니라 사각지대다.

### 4.4 “프로젝트”라는 단어가 네 가지 뜻을 가진다

과거 deal-workspace 설계는 “프로젝트”를 Opportunity 전체 수명주기의 사용자 이름으로
되찾으려 했다. 현재 제품과 스키마에는 동시에:

1. 테넌트 범위 `Project`
2. 영업기회 `Opportunity`
3. 구축·이행 `Engagement`
4. 재무 집계 `FinanceProject`

가 있다.

이 보고서는 최종 제품 용어를 다음처럼 잠근다.

| 사용자 용어 | 코드 객체 | UI 원칙 |
|---|---|---|
| 회사 운영 공간 | tenant `Project` | CRM 화면에서 “프로젝트”라고 부르지 않음 |
| 딜 / 영업기회 | `Opportunity` | `/deals`, 영업 파이프라인 |
| 구축 / 이행 | `Engagement` | UI label은 **구축**; `/projects`는 장기적으로 `/delivery` 검토 |
| 재무 집계 | `FinanceProject` | 사용자에게는 재무 집계 또는 원가센터 |
| PoC | `PocProject` | “PoC 프로젝트” 대신 **PoC** |

앞으로 사용자에게 “프로젝트”라는 단독 명칭을 핵심 객체 이름으로 쓰지 않는다.
“신규 프로젝트”라는 일상 표현은 intake에서 `구축`, `PoC`, `내부 작업` 중 무엇인지
AI가 되묻거나 후보를 보여준다.

---

## 5. 상용 CRM에서 배울 것

이번에 검토한 다섯 상용 CRM의 공통점은 “모든 것을 하나의 파이프라인에 넣는다”가 아니다.

| 제품 | 객체와 관계 | 프로세스 | AI | BLRO가 가져올 것 |
|---|---|---|---|---|
| Salesforce | 표준·커스텀 객체, 다양한 관계, Task/Event가 여러 객체를 가로지름 | Flow·Approval Process | Agentforce는 정의된 Agent Action을 통해서만 쓰기 | 명시적 AI 도구 권한, 활동의 다중 객체 연결 |
| HubSpot | 표준 밖 업무를 커스텀 객체로 만들고 속성·파이프라인·연결 정의 | AI·템플릿·직접 설계 워크플로 | CRM 객체와 자동화 안에서 보조 | 객체별 수명주기와 관계를 관리자 수준에서 다룸 |
| Dynamics 365 | Dataverse 표준·커스텀 테이블, 판매·서비스·프로젝트 앱 공유 | BPF는 일관된 입력·단계 가이드 | 요약·메일·회의·기회 업무 보조 | 공통 데이터층 위에 업무별 앱과 가이드 분리 |
| Zoho CRM | 커스텀 모듈·객체, 승인·비즈니스 프로세스 | no-code 자동화 | 문맥 보조·콘텐츠·프로세스 지원 | 표준 업무와 확장 업무를 같은 관계 모델에 둠 |
| Pipedrive | 딜과 별도 Projects, Activities, 자동화 | 간단한 pipeline 자동화와 AI Sales Assistant | fixed-entity UX 안에서 보조 | 쉬운 업무 진입과 활동 중심성만 참고 |

검증된 핵심 사실:

- Salesforce의 Task/Event는 Account·Case·Opportunity 등 여러 객체와 연결된다
  ([Salesforce Tasks & Events](https://developer.salesforce.com/docs/platform/data-models/guide/tasks-events.html)).
- Salesforce Agentforce는 명시적으로 정의된 agent action 없이 레코드를 변경하지 못한다
  ([Agent-ready Flows](https://trailhead.salesforce.com/content/learn/modules/agent-customization-with-flows/learn-how-to-make-agent-ready-flows)).
- HubSpot 커스텀 객체는 표준 CRM 밖의 비즈니스 프로세스를 표현하고 자체 속성·파이프라인·연결을 가진다
  ([HubSpot Custom Objects](https://knowledge.hubspot.com/object-settings/create-custom-objects)).
- HubSpot 워크플로는 AI·템플릿·처음부터 만들기를 모두 지원한다
  ([HubSpot Workflows](https://knowledge.hubspot.com/workflows/create-workflows)).
- Dynamics의 Business Process Flow는 고객 업무를 일관된 단계로 안내하는 장치이지
  모든 테이블을 하나의 영업기회로 만드는 장치가 아니다
  ([Microsoft BPF](https://learn.microsoft.com/en-us/power-automate/business-process-flows-overview)).

### 가져오지 말아야 할 것

- Salesforce식 설정 복잡도
- Dynamics식 거대한 제품군
- HubSpot식 상위 요금제에 묶인 핵심 확장
- 모든 업무를 관리자 커스텀 설정으로 해결하는 방식

우리는 BLRO의 실제 업무 객체를 제품 코드로 명확히 유지해야 한다.

---

## 6. 오픈소스 CRM에서 배울 것

### Twenty — 가장 가까운 AI-native 참고점

Twenty 공식 문서는 다음을 명확히 말한다.

- Company·People·Opportunity·Task·Note 외에 Project·Support Ticket·Contract 같은
  커스텀 객체를 만들 수 있다.
- 커스텀 객체도 API·뷰·권한·워크플로 트리거를 동일하게 가진다.
- 워크플로는 레코드 이벤트·수동·스케줄·웹훅으로 시작할 수 있다.
- 액션은 레코드 생성/수정, 메일, HTTP, 코드, 분기, 폼, AI agent를 조합한다.
- AI agent는 권한 모델 안에서 동작하고 수동 승인과 결합할 수 있다.

출처:
[Twenty Data Model](https://docs.twenty.com/getting-started/core-concepts/data-model),
[Twenty Workflows](https://docs.twenty.com/getting-started/core-concepts/workflows),
[Twenty AI](https://docs.twenty.com/getting-started/core-concepts/ai).

우리가 가져올 것은 동적 스키마 자체가 아니다.
**AI가 별도 장식이 아니라 객체·관계·권한·워크플로 안에서 일한다는 원칙**이다.

### Odoo — 업무별 앱과 연결된 운영 모델

Odoo의 broader product suite는 CRM, Project, Helpdesk, Subscription, Accounting 같은
typed app을 관계와 자동화로 연결한다. 자동화 규칙은 트리거와 조건에 따라 활동 생성,
레코드 변경, 웹훅 등을 수행한다
([Odoo Automation Rules](https://www.odoo.com/documentation/19.0/applications/studio/automated_actions.html)).

다만 이번에 pin한 Odoo Community Edition 19.0 소스에는 Enterprise의
`sale_subscription` 수명주기가 없고, CRM의 recurring revenue forecast 필드만 확인됐다.
따라서 “오픈소스 Odoo가 완전한 리뉴얼 앱을 제공한다”는 근거로 사용하지 않는다.

가져올 것은 **업무별 typed app을 관계와 자동화로 연결하는 것**이다.
버릴 것은 모듈 모놀리스의 복잡성이다.

### EspoCRM·SuiteCRM — 관리자 확장과 독립 모듈

EspoCRM core는 Entity Manager, 관계·레이아웃, formula·hook·webhook·job, ACL·audit를
제공한다. 시각적 Workflow/BPM은 paid Advanced Pack 경계다.
SuiteCRM은 Module Builder와 Project·Case·Workflow 같은 독립 모듈을 제공한다.
AI 관점에서는 오래된 방식이지만, 업무 객체를 영업기회의 하위 단계가 아니라 별도 모듈로
다루는 점은 참고할 수 있다.

### Erxes·Corteza — 플러그인과 low-code의 경계

Erxes는 plugin process와 GraphQL federation으로 모듈을 결합하고,
Corteza는 low-code Compose, workflow, RBAC, action log를 조합한다.

가져올 것은 객체를 peer module로 확장하고 역할·권한·감사를 공통 계층에 두는 패턴이다.
주의할 점도 분명하다.

- Erxes의 plugin process 분리는 shared Redis/MQ/Mongo를 포함하므로 data-plane sandbox를
  자동으로 보장하지 않는다.
- Corteza의 범용 low-code는 BLRO의 quote·SLA·approval 같은 canonical domain rule을
  임의 설정으로 대체할 이유가 아니다.

근거는 [오픈소스 CRM SHA·release 증거표](../research/2026-08-13-opensource-crm-evidence-matrix.md)의
Erxes `f734e808...`, Corteza `3b69e9f...` source pin이다.

### 오픈소스 비교의 결론

BLRO가 Twenty나 Odoo로 갈아탈 이유는 없다. 현재 시스템은 이미:

- BLRO 도메인에 맞춘 승인·감사
- 메일 인텔리전스
- BLRO 맞춤 견적·마진
- 역할/컬러 AI 조직
- CFO·재무 연결

을 가지고 있다.

필요한 것은 교체가 아니라 **기존 도메인 자산을 하나의 일관된 접수·맥락·실행 문법으로
재배치하는 것**이다.

---

## 7. 목표 제품 구조

### 7.1 제품의 네 중심

#### A. Customer Context — 홈

사람이 “케이브이머티리얼즈에 무슨 일이 있지?”라고 물을 때 답하는 화면이다.

고정 요약:

- 고객·관계자·파트너
- 최근 메일과 회의
- 진행 중인 모든 업무
- 보유 자산·구독
- 마감·만료·SLA
- 보류 중인 승인
- AI가 제안하는 다음 행동

#### B. Work — 실행 단위

모든 업무를 새 테이블 하나로 합치지 않는다.

| 업무 종류 | 원본 객체 |
|---|---|
| 영업 | Opportunity |
| PoC | PocProject |
| 구축 | Engagement |
| 기술지원 | SupportCase |
| 리뉴얼 | RenewalOpportunity |
| 세부 실행 | WorkTask |

`My Work`에는 이 객체들을 같은 형식의 얇은 read model로 모은다.

```ts
type OpenWorkItem = {
  kind: "opportunity" | "poc" | "engagement" | "support" | "renewal" | "task";
  id: string;
  customerId?: string;
  title: string;
  lifecycleState: string;
  ownerId?: string;
  dueAt?: string;
  attention: "normal" | "due" | "blocked" | "approval";
  href: string;
};
```

초기에는 DB 테이블을 새로 만들 필요가 없다. 기존 객체를 합쳐 보여주는 projection이면 충분하다.

#### C. Pipeline — 영업 관측 뷰

유지할 것:

- 7단계 enum
- BANT
- 등록
- 단계 이력
- 예상 매출·마진
- 정체 구간·전환율

바꿀 것:

- PoC·지원·리뉴얼·프로젝트 생성의 부모 역할
- 모든 업무의 기본 홈 역할
- 단계가 실행 상태와 승인 상태를 동시에 표현하는 구조

각 업무는 세 축을 따로 가져야 한다.

1. **Lifecycle state** — LEAD, testing, open, renewed 등
2. **Work state** — 다음 행동, 담당, 기한, 막힘
3. **Decision authority** — 초안, 검토 대기, 승인, 실행

#### D. Gate — 위험 통제

| 행동 | 통제 |
|---|---|
| 내부 작업·메모·PoC·지원·리뉴얼 초안 생성 | 기본 허용 |
| 딜 단계 전진 | BANT·순서·조건부 등록 |
| 프로젝트에 기존 딜 자료 흡수 | 전환 검증 |
| 저마진·견적 발송·계약·구매 | 상업 승인 |
| 납품 검수·자산 생성 | 검수·AI release 조건 |
| 외부 메일·공유·삭제·내보내기 | 명시적 승인 |
| AI T1/T2 행동 | 사람 확인 |

#### Engagement 관계의 목표 결정

현재 `Engagement.opportunityId`는 **필수이면서 `@unique`**다
(`packages/db/prisma/schema.prisma:3708-3735`). 즉 한 딜에서 하나의 구축만 만들 수 있고,
딜 없는 구축은 만들 수 없다.

목표 계약은 다음과 같다.

- `Engagement.opportunityId`: nullable
- 한 Opportunity: 여러 Engagement 허용
- 각 Engagement는 `phase` 또는 별도 `deliveryKey`로 idempotency 보장
- 기존 `convert_to_project`: 첫 Engagement를 만들거나 기존 phase를 찾아 자료를 흡수
- Finance·Invoice·Acceptance는 Engagement를 직접 기준으로 유지
- Opportunity forecast는 Engagement 수와 무관

이는 단일 migration으로 바꾸지 않는다.

1. 읽기 경로가 nullable·다중 Engagement를 견디게 한다.
2. 새 idempotency key/phase와 조회 helper를 추가한다.
3. 기존 row를 그대로 보존한다.
4. FK를 nullable로 바꾸고 unique를 제거하는 formal migration을 적용한다.
5. 기존 전환·재무·RLS·복구 테스트를 통과한 뒤 독립 구축을 연다.

#### StageEvent의 역할

`OpportunityStageEvent`는 **영업 파이프라인 이력과 예측 보정 신호**로 유지한다.
사람의 승인·AI 수정·업무 실행 학습의 정본으로 승격하지 않는다.

- 영업 단계 학습: StageEvent
- 사람/AI 의사결정 학습: DomainDecisionLog + DomainMemory
- 실행 승인·version binding: GovernedProposal + ApprovalRequest
- 범용 업무 이벤트: 각 typed domain status event

### 7.2 통합 업무 접수

세 입력 채널이 같은 결과로 모여야 한다.

| 입력 | 예 | 공통 결과 |
|---|---|---|
| 자연어 | “KV HCI 4월 말 만료, 2,100만원” | Action Proposal |
| 메일 | 고객·파트너 메일 | Action Proposal 또는 검토 후보 |
| 폼 | 고객 화면의 `새 업무` | 같은 기존 writer |

#### 실행 제안서

```ts
type ActionProposal = {
  source: "natural_language" | "mail" | "form" | "agent" | "system";
  intentText: string;
  context: {
    customerId?: string;
    matchedAliases: string[];
    relatedRecords: Array<{ kind: string; id: string }>;
  };
  actions: Array<{
    actionType: string;
    entityKind: string;
    entityId?: string;
    payload: unknown;
    riskTier: "T0" | "T1" | "T2";
    reversible: boolean;
    confidence: number;
    missingFields: string[];
  }>;
  status: "draft" | "awaiting_confirmation" | "approved" | "rejected" | "executed";
};
```

정본은 다음처럼 결정한다.

- **제안 정본:** 기존 `GovernedProposal`
- **사람 승인·revision lock:** 기존 `ApprovalRequest`
- **실행·학습 기록:** `DomainDecisionLog`

ActionProposal은 새 승인 시스템이나 새 SoT가 아니라 이 세 자산을 CRM intake에 적용하는
API/UX 계약 이름이다. 자연어 원문과 구조화 payload는 GovernedProposal content와
contentHash에 저장하고, ApprovalRequest의 exact revision/CAS로 사람 확인을 묶는다.
실행 시 같은 canonical payload hash를 transaction 안에서 다시 확인하고, 다르면 중단한다.
실행 후 DomainDecisionLog에 proposalId·approvalRevision·payloadHash·result를 남긴다.

DomainDecisionLog는 best-effort 보조 학습 로그이므로 승인 정본이나 실행 차단기로 사용할 수
없다. AI 실행의 입력→제안→사람 revision→payload hash→결과는 실행 transaction 안에서
scoped hardened audit chain에 모두 남아야 한다.

향후 별도 ActionProposal 테이블은 cross-domain 목록/검색이 병목이고 기존 proposal
artifact로 표현할 수 없을 때만 검토한다. 새 모델은 처음부터 tenant/company/project scope와
RLS를 가져야 한다.

### 7.3 AI 직원의 공통 운영 루프

```text
관찰
  → 구조화된 제안
  → 필요시 5색 검증
  → 권한·위험도 판정
  → 사람 확인 또는 위임된 T0 실행
  → 기존 writer 실행
  → 감사
  → 사람 수정에서 학습
```

| 위험 | observe | suggest | auto |
|---|---|---|---|
| T0 내부·가역 | 보기만 | 한 번 확인 | 정책 허용 시 가능 |
| T1 외부·중간 위험 | 보기만 | 사람 승인 | 금지 |
| T2 돈·삭제·계약·고위험 | 보기만 | 명시적 사람 승인 | 금지 |

목표 실행 규칙에서 등록되지 않은 action type은 거부한다. 현재 `gateDecision`은 T2 label을
붙이는 best-effort 로깅일 뿐 실행을 막지 않으므로 그대로 활용할 수 없다. AI가 writer를
호출하기 전에 synchronous·actor-aware·fail-closed enforcement를 새 실행 경로에 넣어야 한다.
특히 현재 T0인 `stage_transition`, `entity_edit`, `entity_archive`는 사람 직접 행동과
AI 제안 행동의 tier를 분리하기 전까지 AI 자동 실행 대상이 아니다.

메일 본문 같은 외부 입력은 untrusted provenance로 표시한다. mail-derived proposal은
confidence나 autonomy mode와 무관하게 자동 실행할 수 없다.

### 7.4 AI-native 운영 패턴 13개

| # | 패턴 | 최소 계약 |
|---|---|---|
| P1 | 자연어 접수 | `IntakeEnvelope`; parse 단계에서는 CRM 변경 없음 |
| P2 | 의도·엔터티 해석 | customer/asset 후보, alias, confidence, abstain |
| P3 | 쓰기 전 제안 | exact payload·risk·reversible·contentHash |
| P4 | 컨텍스트 그래프 | typed hard edge + governed soft attachment |
| P5 | 역할 AI 직원 | role, caseRef, sponsor/service principal, permission |
| P6 | handoff | source/target role, context summary, SLA, audit |
| P7 | 사람 승인 | ApprovalRequest exact revision + canonical hash |
| P8 | 권한 | AuthContext/RLS/ABAC + actor-aware action tier |
| P9 | 되돌리기 | archive·compensation·manual recovery |
| P10 | 감사 | transaction 안의 scoped hash chain |
| P11 | 메모리·학습 | 사람 결정 뒤에만 DomainMemory update |
| P12 | 이벤트 제안 | 날짜/SLA/mail signal → proposal, 임의 금액 금지 |
| P13 | 모호성 처리 | multi-match, missing fields, clarification, abstain |

목표 API 표면은 `intake → resolve/clarify → governed proposal → approve → commit`,
그리고 `context`, `handoff`, `suggestion`, `revert`, `audit`이다. 처음부터 13개를 모두
구현하지 않고 KV 리뉴얼 한 수직 사례에서 P1·P2·P3·P7·P8·P10·P13을 먼저 검증한다.

### 7.5 중첩 운영 그래프 계약

BLRO OS는 객체 목록이나 하나의 거대한 테이블이 아니라 **중첩된 운영 그래프**로 정의한다.
tenant `Project` 하나가 논리적인 전체 그래프의 스코프이고, 각 Customer는 그 안에서 고객
맥락 서브그래프의 앵커다. Opportunity·PocProject·Engagement·SupportCase·
RenewalOpportunity 같은 업무 노드는 다시 작업·증거·결정·상태 이벤트를 품은 작은
서브그래프다.

```text
BLRO OS 운영 그래프 (tenant Project scope)
├─ 고객 A 맥락 그래프
│  ├─ Opportunity 서브그래프 ─ BANT · Quote · Approval · StageEvent
│  ├─ PoC 서브그래프 ─ Requirement · WorkTask · Artifact · Result
│  ├─ Engagement 서브그래프 ─ Phase · WorkTask · Acceptance · Finance
│  ├─ Support 서브그래프 ─ Asset · SLA · WorkTask · Resolution
│  └─ Renewal 서브그래프 ─ Asset/Subscription · Reminder · Quote · Outcome
├─ 고객 B 맥락 그래프
├─ 사람·역할 AI·Assignment 그래프
└─ 제안·승인·감사·학습 그래프
```

#### 그래프의 노드 경계

| 계층 | 노드 | 내부에 포함되는 로컬 그래프 |
|---|---|---|
| 운영 스코프 | tenant `Project` | Customer·Partner·사람·AI·전역 정책 |
| 고객 맥락 | Customer | 연락처·메일·회의·자산·구독·열린 업무 |
| 업무 aggregate | Opportunity·PoC·Engagement·Support·Renewal | 상태·작업·증거·승인·이력·결과 |
| 실행 | WorkTask·ActionProposal | 담당·기한·입력·payload·실행 결과 |
| 거버넌스 | GovernedProposal·ApprovalRequest·Audit | revision·hash·결정·actor·provenance |
| 학습 | DomainDecisionLog·DomainMemory·개선 버전 | 결과·사람 수정·평가·승격·롤백 근거 |

“노드 안의 그래프”는 JSON 한 필드에 관계를 숨긴다는 뜻이 아니다. 각 업무 aggregate가
자기 규칙으로 로컬 관계를 소유하고, 등록된 경계 edge만 다른 서브그래프와 연결된다는
뜻이다. 세부 쓰기는 해당 도메인 service만 수행하고, Customer Context와 My Work는 이
그래프들을 합성한 읽기 전용 projection이다.

#### Edge 카탈로그

| edge 종류 | 예 | 방향·카디널리티 | 계약 |
|---|---|---|---|
| Hard domain edge | Support→Asset, Quote→Opportunity, Acceptance→Asset | 명시적 FK와 도메인 cardinality | 돈·SLA·권한·gate 판단에 사용, RLS와 writer 검증 필수 |
| Governed soft edge | WorkTask→Mail, Renewal→참고 PoC | 등록된 attachment, 다대다 가능 | 문맥 전용, hard edge를 대신하거나 권한을 상속하지 않음 |
| Event edge | SupportResolved→RenewalRisk, StageChanged→Forecast | append-only causation/correlation | 다른 서브그래프의 제안 신호가 될 수 있으나 직접 쓰지 않음 |
| Decision edge | Proposal→Approval→Execution→Result | exact revision과 payload hash로 1개 실행에 결속 | 승인·감사·재실행 방지의 정본 |
| Learning edge | Result/Correction→ImprovementCandidate→Version | 출처와 평가 결과를 가진 버전 관계 | 운영 데이터를 직접 덮지 않고 개선 후보만 생성 |

#### 로컬 그래프를 전체 그래프로 합치는 규칙

1. 모든 노드와 edge는 같은 tenant `Project` 스코프를 증명해야 한다.
2. 서브그래프 경계를 넘는 연결은 edge registry에 등록된 hard/soft/event/decision/
   learning 종류만 허용한다.
3. Hard edge의 권한·위험은 암묵적으로 전이되지 않는다. 경계를 넘을 때 대상 도메인의
   RLS·ABAC·gate를 다시 계산한다.
4. Soft edge는 검색과 설명에만 쓰며 금액·SLA·승인 조건의 정본이 될 수 없다.
5. Event edge는 원인 node, actor, causationId, correlationId, 발생 version을 남긴다.
6. 전체 그래프 projection은 읽기 모델이다. 변경은 언제나 원래 typed domain writer로
   돌아간다.

이는 graph database 도입을 의미하지 않는다. 1차 구현은 기존 Prisma FK를 hard edge로,
검증된 attachment를 soft edge로, 도메인 이벤트를 순환 신호로 사용한다. 관계형 저장소가
성능·탐색 깊이에서 실제 병목임을 측정하기 전까지 graph database는 계속 유예한다.

### 7.6 거버넌스된 자가개선 폐쇄 루프

운영 루프와 개선 루프는 분리하되 하나의 순환 그래프로 연결한다.

```text
[운영 루프]
관찰 → 제안 → 검증 → 승인/위임 → 실행 → 결과·사람 수정
  ▲                                      │
  │                                      ▼
  │
  └─ 승격된 memory/policy/prompt version ← 운영 감시
                                            ▲
                                            │
[개선 루프] 결과·수정·지표 → 개선 후보 → 고정 평가셋·회귀·안전성 평가
                                      → 사람 승인 → version 고정
                                      → shadow/canary 적용
                                      ├─ 합격: 승격
                                      └─ 실패: 이전 version 롤백
```

`DomainDecisionLog`와 `DomainMemory`는 이 루프의 입력 증거이지, 그 자체로 자가개선
시스템은 아니다. 운영 중인 AI가 prompt·policy·권한·writer를 직접 고치는 것은 금지한다.
사람 수정에서 바로 갱신할 수 있는 것은 출처가 묶인 case memory뿐이며, 다음 계약을 거친
승인된 version만 미래 행동을 바꿀 수 있다.

| 개선 계약 | 반드시 남길 값 |
|---|---|
| 개선 후보 | 대상 memory/prompt/policy/action, 이전 version, 근거 outcome/correction IDs |
| 평가 | 고정 평가셋 version, baseline, 품질·보안·권한 회귀 결과, 합격 임계값 |
| 승인 | 승인자, exact candidate revision, canonical hash, 승인 시각 |
| 적용 | shadow/canary 범위, 시작 version, 대상 action/tenant, kill switch |
| 감시 | 채택·수정·오연결·반려·중복·SLA·금액 오류와 rollback 임계값 |
| 추적 | 매 실행이 사용한 model·prompt·policy·memory·action-registry version |
| 종료 | 승격된 version 또는 이전 version 복원, 결정 이유와 감사 chain |

따라서 자율성 확대는 “로그가 쌓였다”가 아니라 **같은 평가셋에서 개선되고, 운영 지표가
악화되지 않으며, 사람 승인과 롤백 경로가 증명된 version이 생겼다**는 뜻이다.

---

## 8. 케이브이머티리얼즈 리뉴얼은 이렇게 동작해야 한다

### 사용자 입력

> 케이브이머티리얼즈 / HCI / 2027-04-30 / 21백만원

### AI의 첫 응답

```text
리뉴얼 업무로 이해했습니다.

고객        케이브이머티리얼즈
제품        HCI
만료일      2027-04-30
예상 금액   21,000,000원

찾은 관계
- “케이브이머티리얼즈” 관련 기존 딜 2건
- 정식 고객 레코드는 아직 없음
- HCI 자산·구독 레코드는 아직 확인되지 않음

제안
1. 고객 레코드 생성 후 기존 딜 2건 연결
2. HCI 보유 자산 초안 생성
3. 리뉴얼 업무를 pending으로 생성
4. D-120 확인 작업, D-90 고객 안내 작업 예약

[내용 수정] [업무만 만들기] [확인하고 생성]
```

핵심은 AI가 “고객 레코드가 없으니 먼저 직접 만들라”고 돌려보내지 않는 것이다.
관계를 찾아 **하나의 제안으로 묶되**, 잘못된 고객 합병이나 금액 발송은 자동으로 하지 않는다.

### 생성 후 협업

- Sales AI: 기존 거래·파트너·최근 메일 요약
- Presales AI: HCI 구성·버전·기술 변경 확인 요청
- Engineer AI: 설치 자산·라이선스 근거 확인
- CFO AI: 이전 견적·마진과 2,100만원의 합리성 검토
- Human: 고객 식별·금액·외부 발송 승인
- Color agents: 외부 견적·제안서가 생길 때만 검증

이 사례가 새로운 제품 구조의 **첫 번째 golden journey**가 되어야 한다.

여기서 HCI와 2,100만원은 사용자가 제공한 업무 입력이지 검증된 운영 데이터가 아니다.
제안서는 기존 고객·자산·견적과 비교해 “사용자 제공값”으로 표시하고, 실제 외부 견적의
근거로 사용할 때 다시 사람 확인을 받아야 한다.

---

## 9. 유지·개편·폐기·유예

### 유지

- Customer·Partner·Contact
- Opportunity와 7단계 파이프라인
- BANT·등록·상업·납품 게이트
- PoC와 WorkTask
- Quote·마진의 서버 권위
- CustomerAsset·SupportCase·RenewalOpportunity
- MailDerivedCandidate와 메일 인텔리전스
- Approval·Audit·Decision·Autonomy·DomainMemory
- CFO·재무

### 개편

- 고객 화면을 주 홈으로 승격
- 모든 도메인 화면에 일관된 `새 업무` 진입점
- Engagement의 독립 생성
- 지원 생성 UI
- 수동 리뉴얼과 날짜 기반 투영 로직
- 딜에서 PoC를 만들 때 자동 연결
- 견적 생성 UX
- AI 어시스턴트를 Action Proposal 흐름으로 연결
- `My Work`에 모든 도메인 업무를 통합
- tenant Project는 회사 운영 범위, Opportunity는 딜, Engagement는 구축,
  FinanceProject는 재무 집계로 이름을 고정

### 행동 수준에서 폐기

- “프로젝트 = 전환된 딜만”이라는 유일 경로
- 모든 업무를 딜 단계에 맞춰 시작하는 제품 설명
- 실제 실행 없는 AI 역할 라벨과 장식성 버튼
- 지원 UI의 가짜 5단계
- 리뉴얼 배치의 임의 금액·임의 영업기회·`p1/c1` 대체값

### 유예

- 외부 CRM으로 교체
- graph database
- 모든 도메인을 하나의 Case 테이블로 합치기
- 런타임 커스텀 객체 플랫폼
- 7단계 enum 교체
- 완전 자율 AI

---

## 10. 점진적 전환 순서

### Phase 0 — 데이터의 진실부터 복구

목표: AI가 잘못된 데이터를 자동 생성하기 전에 현재 경로를 신뢰할 수 있게 한다.

- 리뉴얼 날짜 필드 불일치 수정
- `10000`, `p1`, `c1`, 임의 첫 딜 연결 제거
- 모든 query를 tenant/project scope로 제한하고 title dedup을 unique idempotency key로 교체
- 프로젝트 허브·견적 생성·지원 상태 등 확인된 진실성 결함 점검
- 공통 제품 용어 사전 확정
- `stageEnteredAt` writer와 실제 stage event timestamp 일치
- WorkTask·지원·리뉴얼·구축의 `ownerAssignmentId` 계약 정리
- Mail candidate의 `poc` typed-but-unconvertible dead end 제거
- 현재 FK·attachment·event를 node/edge registry로 목록화하고 tenant 경계 위반을 검사
- 모든 AI 실행에 현재 model·prompt·policy·memory·action-registry version 기록

성공 증거:

- operator 경로로 투영한 리뉴얼이 화면에 보인다.
- 금액·고객·프로젝트를 임의로 만들지 않는다.
- 현재 다섯 업무의 실제 생성 가능 여부가 테스트와 화면 설명에서 일치한다.
- 같은 tenant 안의 등록된 edge만 탐색되고 cross-tenant 경계 테스트가 실패 폐쇄된다.

### Phase 1 — 업무가 독립적으로 태어나게 한다

- 고객 화면 `새 업무`
- PoC 문맥 prefill
- 지원 생성 UI
- 수동 리뉴얼 생성
- 구축 프로젝트 독립 생성
- 각 업무 aggregate의 로컬 서브그래프와 허용된 경계 edge 계약

구축의 최종 목표 모델은 `Engagement.opportunityId`가 선택 관계가 되고 한 딜이 여러
구축 phase를 가질 수 있는 것이다.
기존 프로젝트는 모두 기존 딜과 연결된 채 유지하고, 새 독립 프로젝트만 null을 허용하는
다단계 additive/nullable migration을 검토한다. 이 경로를 택하려면 조회·재무 join·RLS·
기존 전환 테스트의 dual-read 계획을 먼저 작성해야 한다.

임시로 숨은 가짜 Opportunity를 만드는 방법은 FK 변경 없이 빠르게 실험할 수 있지만,
`DELIVERY_DIRECT`가 영업 보드·예측·홈 KPI·AI prompt에서 한 곳이라도 걸러지지 않으면
가짜 수주가 된다. 따라서 **기본안은 nullable 관계**, shadow Opportunity는
단일 `isSalesPipelineOpportunity` 정책과 예측 격리를 증명한 경우의 짧은 전환안으로만 둔다.

성공 증거:

- 프로젝트·PoC·지원·리뉴얼 모두 영업 단계 전진 없이 사람 화면에서 생성 가능하다.
- 기존 딜 전환 경로는 그대로 작동하고 자료 흡수 기능도 유지된다.
- 지원의 자산·SLA 통제는 유지된다.
- 새 업무는 Customer 서브그래프에 연결되며 orphan edge와 임의 관계 종류가 생기지 않는다.

### Phase 2 — 케이브이머티리얼즈 golden journey

범용 AI를 한꺼번에 만들지 않는다.

먼저 이 한 문장을 end-to-end로 처리한다.

> 케이브이머티리얼즈 / HCI / 2027-04-30 / 21백만원

필요 기능:

- 자연어 접수
- 고객·별칭·기존 딜 해석
- 누락 관계 표시
- 리뉴얼 Action Proposal
- 한 번의 사람 확인
- 리뉴얼·작업 생성
- 감사 기록
- 생성 결과와 사람 수정이 outcome/event edge로 개선 증거에 연결

성공 증거:

- 애매한 고객은 확인 없이 합치지 않는다.
- 제안 전에는 CRM을 변경하지 않는다.
- 확인 후 생성된 레코드가 고객 맥락과 리뉴얼 화면에 함께 보인다.
- 거절·수정 내용이 AI 학습 근거로 남는다.
- 입력에서 결과까지 causationId로 추적되고, 결과 신호가 다음 제안의 관찰 입력으로 돌아온다.

### Phase 3 — Customer Context와 My Work

- 고객 360을 실제 기본 홈으로 승격
- 모든 업무의 open-work projection
- 사람·AI 초안·승인·마감 통합 큐
- 단계가 아니라 `지금 주의가 필요한 이유`로 정렬
- Customer 앵커에서 도메인 서브그래프를 합성하는 읽기 전용 global graph projection

성공 증거:

- 대표가 고객 하나를 열어 활성 업무와 다음 행동을 찾기까지 화면 이동이 줄어든다.
- 담당·기한 없는 업무 비율이 줄어든다.
- global projection과 각 원본 workspace의 상태가 일치하고 soft edge가 권한을 우회하지 않는다.

### Phase 4 — 역할별 AI 직원 연결

- Sales AI: 딜·리뉴얼·후속 작업 제안
- Presales AI: BANT 기술 항목·PoC 요구사항 초안
- Engineer AI: 지원·자산·RCA·납품 작업
- CFO AI: 견적·마진·현금·갱신 금액 검토
- Marketing AI: 인입·캠페인·고객 신호
- Color agents: 외부 산출물 검증

처음에는 모두 `observe/suggest`에서 시작한다. 각 AI는 caseRef가 가리키는 bounded
subgraph와 등록된 인접 edge만 읽고, 다른 서브그래프가 필요하면 감사 가능한 handoff를
만든다.

성공 증거:

- 모든 제안에 사용한 subgraph snapshot과 model·prompt·policy·memory version이 남는다.
- 허용되지 않은 edge 탐색과 writer 호출은 실행 전에 차단된다.

### Phase 5 — 측정·자가개선·위임 확대

자율화는 기능 출시가 아니라 측정 결과다.

- AI 제안 채택률
- 사람 수정률
- 잘못 연결된 고객·자산 비율
- 승인 반려율
- 중복 레코드율
- 업무 생성부터 첫 행동까지 시간
- 영업 예측 정확도
- 지원 SLA
- 리뉴얼 누락률

운영 결과와 사람 수정은 `ImprovementCandidate`를 만들 수 있지만 production 동작을
직접 바꾸지 않는다. 후보는 고정 평가셋·회귀·보안 평가, 사람 승인, version 고정,
shadow/canary, 운영 감시를 거친다. 합격하면 다음 관찰·제안이 새 version을 사용하고,
임계값을 벗어나면 이전 version으로 되돌린다.

T0 자동 실행은 이 폐쇄 루프와 지표가 함께 안정된 행동부터 좁게 연다.

성공 증거:

- 같은 입력 평가셋에서 후보 version이 baseline보다 낫고 권한·금액 회귀가 없다.
- canary의 수정률·오연결률·반려율이 임계값 안이며, 초과 시 이전 version 복원이 증명된다.
- 다음 실행의 감사 기록에서 승격된 version 사용을 확인할 수 있다.

### 모든 Phase를 막을 공통 출시 조건

다음은 선택사항이 아니라 skeptic 검토를 통과한 공통 조건이다.

1. **Gate Matrix**  
   각 action type마다 필수 맥락, 위험도, 승인자, override 권한을 기계가 읽을 수 있게 둔다.
2. **소유권**  
   독립 WorkTask·지원·리뉴얼·프로젝트는 free-text 담당자 대신 `ownerAssignmentId`와
   revision 규칙을 사용한다.
3. **중복 방지**  
   고객+자산+업무종류+기간 같은 자연키 후보를 확인하고 기존 건 연결·병합 UI를 제공한다.
4. **AI 주체성**  
   AI 실행에는 사람 sponsor 또는 명시적 service principal이 남아야 한다.
5. **단계 자동화 재검토**  
   현재 `stage_transition` 같은 쓰기 행동이 T0이면 사람/AI 주체에 따라 T1 이상으로
   나누기 전에는 AI 직원 자동화를 열지 않는다.
6. **관찰 지표 선행**  
   create source, duplicate, gate block, owner missing, forecast error를 기능 출시 전부터 기록한다.
7. **이중 경로 종료 시점**  
   기존 경로와 새 경로를 함께 둘 경우 한 릴리스 안에 기본 경로와 폐기 경로를 결정한다.
8. **되돌리기 훈련**  
   feature flag를 끈 뒤 기존 row count와 기존 전환 경로가 유지되는지 staging에서 확인한다.

9. **AI 실행 enforcement**  
   현재의 label-only `gateDecision`을 실행 경로의 synchronous fail-closed 검사로 바꾸기
   전에는 어떤 AI도 writer를 호출할 수 없다.
10. **AI 주체와 provenance**  
    역할 AI별 service principal/keyring, 사람 sponsor, subjectId/jti를 기록한다.
    mail-derived proposal은 자동 실행하지 않는다.
11. **payload hash와 hardened audit**  
    승인한 canonical hash와 실행 payload가 다르면 transaction을 중단하고,
    실행 전 과정을 scoped hash chain에 원자적으로 기록한다.
12. **autopilot 기본값**  
    DB row 부재 시 활성화되는 현재 기본값을 `false`로 바꾸고 kill switch를 명시적으로 seed한다.
13. **그래프 합성 경계**  
    node/edge registry, 방향·cardinality·tenant scope, hard/soft/event/decision/learning
    edge의 권한 규칙을 기계가 읽을 수 있게 둔다.
14. **자가개선 version gate**  
    개선 후보는 고정 평가셋·사람 승인·shadow/canary·감시·rollback pointer 없이는
    production memory/prompt/policy로 승격할 수 없다.

### Phase 1에서 잠근 도메인별 최소 식별 규칙

| 업무 | 생성에 필요한 최소 값 | 생성 시 남겨야 할 상태 |
|---|---|---|
| 딜 | title, ownerAssignmentId | LEAD, unqualified |
| PoC | title, ownerAssignmentId | planning, customer/opportunity optional |
| 구축 | name, customerId, ownerAssignmentId | planned, opportunity optional |
| 기술지원 | customerId, assetId 또는 entitlementId, severity, ownerAssignmentId, SLA policy | open, SLA clock started |
| 리뉴얼 | customerId, expiresAt, ownerAssignmentId, assetId 또는 subscriptionId 또는 `unverifiedSource` | pending, amount source 표시 |
| 작업 | title, ownerAssignmentId | todo, link optional |

이 표는 “독립 생성”이 “빈 레코드 생성”을 의미하지 않게 한다.

### 기술지원의 자산 없는 문의

하나의 `SupportCase`에 장애와 일반 문의를 모두 넣지 않는다.

- 설치 장애·계약 지원: asset/entitlement가 확인된 SupportCase만 생성하고 SLA clock을 시작
- 자산 미확인 문의: WorkTask 또는 Intake Proposal 상태로 두고 자산 확인을 먼저 요청
- pre-sales 기술 질문: PoC/Opportunity/WorkTask에 연결

즉 asset requirement를 제거하지 않고, 자산이 없는 입력을 잃지 않는 접수 상태를 제공한다.

---

## 11. 반대 의견과 경계

### “자유롭게 만들면 프로세스가 무너진다”

맞는 우려다. 그래서 자유롭게 만드는 것은 내부 업무의 **존재**이고,
자격검증·외부 약속·돈·납품·삭제는 계속 막는다.

### “고객 화면에 다 넣으면 복잡해진다”

맞다. 고객 화면은 모든 상세 필드를 펼치는 곳이 아니다.

- 현재 상황
- 진행 중 업무
- 다음 행동
- 위험·마감
- 최근 증거

만 먼저 보여주고 상세는 각 업무 workspace에서 다룬다. 이는 progressive disclosure다.

### “AI가 잘못 연결하면 더 위험하다”

그래서 `자연어 → 즉시 실행`을 금지한다.

- 후보와 confidence를 보여준다.
- 누락값을 표시한다.
- 중복·병합·외부 행동은 별도 승인한다.
- 실행은 기존 writer만 사용한다.
- 모든 결정을 감사한다.

또한 AI 제안 기록이 “best effort”라서 조용히 누락되는 현재 경로는 실행 승인의 근거가 될 수
없다. AI가 CRM을 쓰는 경로는 반드시:

- 원문 입력
- 구조화된 제안
- 사람의 확인 revision
- 실행된 payload hash
- 실행 결과

를 실패 폐쇄 방식으로 보존해야 한다.

### “파이프라인을 약화하면 CFO 예측이 망가진다”

파이프라인은 제거하지 않는다. 오히려 영업기회만 남겨 더 정직하게 만든다.
지원·구축·리뉴얼을 억지 딜로 만들지 않으면 영업 파이프라인의 의미가 선명해진다.

### “모든 관계를 자유롭게 만들면 데이터 품질이 무너진다”

관계는 typed link와 검증된 도메인 필드로 제한한다.
임의 JSON과 임의 상태를 핵심 분석·게이트 필드 대신 사용하지 않는다.

관계도 두 종류로 나눈다.

- **Hard edge:** 견적→딜, 지원→자산, 납품검수→자산처럼 돈·SLA·권한을 결정하는 typed FK
- **Soft edge:** 관련 작업·관련 메일·참고 PoC처럼 문맥을 보태는 검증된 attachment

Soft edge도 같은 테넌트/프로젝트인지 확인하고 감사해야 하며, 사용자가 임의 관계 종류를
만드는 기능은 첫 버전에 넣지 않는다.

### “기존 시스템을 다 버리는 것이 빠르다”

아니다. 현재 시스템에서 가장 비싼 자산은 이미 있다.

- 견적·마진 진실
- 승인·감사
- 메일 인텔리전스
- BLRO 데이터
- 도메인 AI·메모리
- CFO

문제는 이 자산의 배치와 사용자 진입점이다. 교체는 가장 비싸고 위험한 해결책이다.

---

## 12. 이번 분석에서 확정된 것과 아직 측정할 것

### 코드·문서로 확정

- 프로젝트는 딜 전환으로만 생성된다.
- PoC와 WorkTask는 독립 생성 가능하다.
- 지원 생성 API는 있지만 화면은 없다.
- 수동 리뉴얼 생성은 없고 투영 구현에 위험한 대체값이 있다.
- 현재 domain pipeline은 운영 CRM writer로 연결되지 않았다.
- 5색 VerificationConsole은 실제 제품의 주 화면에 없다.
- StageEvent는 AI 학습에 소비되지 않는다.
- 고객 중심 관계 모델과 승인·감사 자산은 이미 존재한다.

### 외부 근거로 확정

- 성숙한 CRM은 표준·커스텀 객체와 관계, 별도 자동화, 객체별 프로세스를 조합한다.
- 파이프라인은 영업 예측·병목·자격검증에 유효하다.
- 비정형 지원·PoC·프로젝트 업무는 하나의 사전 정의 순서로 충분히 표현되지 않는다.
- 유연한 데이터도 typed schema·validation·일관된 용어가 필요하다.
- AI의 쓰기는 명시적 도구·권한·승인·감사가 필요하다.

### 실제 사용으로 측정할 것

- 현재 화면에서 다음 행동을 찾는 시간
- 한 업무를 만들기 위한 화면 전환 수
- 고객·업무 중복률
- 영업단계 stale 비율과 예측 정확도
- 지원 SLA
- 리뉴얼 누락률
- AI 연결·분류 수정률

따라서 앞 절의 7.5/9.0 같은 숫자는 이 기준의 baseline이 아니다. 실제 사용자와 운영 데이터를
수집하면 연구자 휴리스틱 심각도는 폐기하고 관찰 지표로 대체한다.

---

## 13. 최종 권고

제품 범주는 **AI-native 회사 운영 CRM**, 전체 제품명은 **BLRO OS**로 잠근다.
구조는 다음 문장으로 정의한다.

> **BLRO CRM은 고객을 중심으로 영업·PoC·구축·지원·리뉴얼·재무 업무를 연결하고,  
> 사람과 역할별 AI 직원이 같은 맥락에서 일하며,  
> 각 업무를 내부 그래프를 가진 typed node로 구성해 하나의 운영 그래프로 합성하고,  
> 파이프라인은 영업을 관측하고 게이트는 위험한 행동을 통제하며,  
> 실행 결과와 사람 수정을 평가·승인·버전·롤백을 거쳐 다음 행동에 반영하는 회사 운영 CRM이다.**

다음 구현의 첫 단위는 거대한 재설계가 아니다.

**케이브이머티리얼즈 리뉴얼 한 문장을 AI가 안전하게 업무로 바꾸는 수직 사례**다.
이 사례를 제대로 만들면 고객 맥락, 자연어 접수, 관계 해석, AI 직원, 사람 승인, 리뉴얼,
작업, 감사, 학습이라는 제품의 핵심이 한 번에 연결된다.

---

## 부록 A. 핵심 내부 근거

| 주제 | 근거 |
|---|---|
| 고객이 척추, 역할/컬러 AI 루프 | `.design-context.md:19-24` |
| 프로젝트 전환 전용 UI | `apps/web/src/app/(portal)/projects/page.tsx:29-44` |
| 프로젝트 전환 stage·PoC gate | `packages/business/src/crm/opportunity-center.ts:977-1017` |
| 독립 PoC | `packages/business/src/crm/poc-center.ts:50-170` |
| 독립 WorkTask | `packages/business/src/orchestration/task-center.ts:32-106` |
| 지원 생성 규칙 | `packages/business/src/support/support-service.ts:26-132` |
| 지원 UI 생성 부재 | `apps/web/src/app/(portal)/support/page.tsx:23-65` |
| 리뉴얼 배치 위험값 | `packages/business/src/support/renewal-projection.ts:54-223` |
| 리뉴얼 조회·상태 UI | `apps/web/src/app/(portal)/renewals/page.tsx:18-171` |
| domain pipeline runtime | `packages/business/src/domain-ai/domain-agent-runtime.ts:245-260` |
| 전역 AI 진입점 | `apps/web/src/components/shell/portal-shell.tsx:310-323` |
| 승인·감사·AI 초안 원칙 | `packages/business/AGENTS.md` |
| 기존 “CRM이 아니라 관제탑” 정의 | `DESIGN.md:10`, `.design-context.md:6` |
| Engagement 필수·unique opportunity | `packages/db/prisma/schema.prisma:3708-3735` |
| GovernedProposal·ApprovalRequest | `packages/db/prisma/schema.prisma`, `packages/business/src/governance/governed-proposal.ts` |

## 부록 A-2. 연구 부록

- [상용 CRM 공식 문서 비교표](../../artifacts/crm-research/2026-08-13-commercial-crm-comparison-matrix.md)
- [오픈소스 CRM SHA·release 증거표](../research/2026-08-13-opensource-crm-evidence-matrix.md)
- [오픈소스 CRM pin JSON](../../artifacts/blro-crm-research/opensource-crm-pins-2026-08-13.json)

## 부록 B. 외부 출처

1. [Salesforce — Objects](https://trailhead.salesforce.com/content/learn/modules/data_modeling/objects_intro)
2. [Salesforce — Object Relationships](https://trailhead.salesforce.com/content/learn/modules/data_modeling/object_relationships)
3. [Salesforce — Tasks & Events Data Model](https://developer.salesforce.com/docs/platform/data-models/guide/tasks-events.html)
4. [Salesforce — Approval Processes](https://trailhead.salesforce.com/content/learn/modules/business_process_automation/approvals)
5. [Salesforce — Agentforce Actions](https://developer.salesforce.com/docs/ai/agentforce/guide/get-started-actions.html)
6. [Salesforce — Agent-ready Flows](https://trailhead.salesforce.com/content/learn/modules/agent-customization-with-flows/learn-how-to-make-agent-ready-flows)
7. [HubSpot — Custom Objects](https://knowledge.hubspot.com/object-settings/create-custom-objects)
8. [HubSpot — Custom Object API](https://developers.hubspot.com/docs/api-reference/crm-custom-objects-v3/guide)
9. [HubSpot — Workflows](https://knowledge.hubspot.com/workflows/create-workflows)
10. [Microsoft — Dataverse Tables](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/create-edit-entities-portal)
11. [Microsoft — Business Process Flows](https://learn.microsoft.com/en-us/power-automate/business-process-flows-overview)
12. [Microsoft — Dynamics 365 Sales Copilot](https://learn.microsoft.com/en-us/dynamics365/sales/copilot-overview)
13. [Twenty — Data Model](https://docs.twenty.com/getting-started/core-concepts/data-model)
14. [Twenty — Workflows](https://docs.twenty.com/getting-started/core-concepts/workflows)
15. [Twenty — AI](https://docs.twenty.com/getting-started/core-concepts/ai)
16. [Odoo — Automation Rules](https://www.odoo.com/documentation/19.0/applications/studio/automated_actions.html)
17. [OMG — Case Management Model and Notation 1.1](https://www.omg.org/spec/CMMN/1.1/PDF)
18. [NIST SP 800-61r3](https://doi.org/10.6028/NIST.SP.800-61r3)
19. [The Scrum Guide](https://scrumguides.org/docs/scrumguide/v2020/2020-Scrum-Guide-US.pdf)
20. [Salesforce — Sales Pipeline](https://www.salesforce.com/sales/pipeline/)
21. [MongoDB — Schema Validation](https://www.mongodb.com/docs/manual/core/schema-validation/)
22. [PostgreSQL — JSON Types](https://www.postgresql.org/docs/current/datatype-json.html)
23. [Nielsen Norman Group — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
24. [DOJ — Evaluation of Corporate Compliance Programs](https://www.justice.gov/criminal/criminal-fraud/page/file/937501/dl)

