# 영업기회(Opportunity) → 프로젝트(Project) 전환 — 최종 재설계 계획서

> 목표: 영업기회(영업기회)를 프로젝트로 전환하면서, 그 영업기회에 딸린 **제안서(제안서)·POC·미팅내용(미팅내용)·견적(견적)·스테이지 이력**을 프로젝트가 흡수하여 단일 작업 공간에서 이어 관리한다.

작성일: 2026-06-28 · 상태: **확정 설계(Red/Blue/Green 2라운드 검토 반영)** · 작성: Lead Architect

---

## 1. 목표·범위

### 목표
- 영업기회 한 건을 **멱등(idempotent)·원자적(atomic)** 으로 프로젝트로 전환한다.
- 전환 시 **검증된 연결 경로만** 따라 제안서·견적·미팅·(opt-in) POC·스테이지 이력을 흡수한다.
- 메일 학습 파이프라인(1220 메일 → 636 `MailInsightThread` → 1122 `mail_derived_candidates`: 영업기회 202 / POC 48 / 태스크 346 / 고객 389 / 파트너 137)의 산출물이 전환된 프로젝트로 흘러들어가, 프로젝트가 "빈 껍데기"가 아니라 day-1부터 채워지도록 한다.

### 정의 & 전환 트리거 (고객 확정 기준, 사용자 확정)
- **기회(Opportunity)** = **고객사가 존재하고 견적서를 요청한 시점**에 성립. (영업 단계 ≈ `QUALIFIED`/`PROPOSAL` — 견적/제안 요청.)
- **프로젝트(Engagement)** = **고객사 미팅 후, 그 미팅에서 POC 계획을 고객사와 확정한 시점**에 기회로부터 전환 생성. (영업 단계 ≈ `POC`.)
- ⇒ 전환 게이트는 **WON이 아니라 "POC 계획 고객사 확정"** 이벤트(§3 결정 E). 프로젝트는 POC 확정~딜리버리까지 이어지는 **딜 워크스페이스**(결정 A = (b) 확정). 전환 시 그 **확정 미팅·POC 계획·앞선 견적/제안**을 흡수한다.

### 범위(In)
- 전환 트리거(PATCH action) + `convertOpportunityToProject` 핵심 로직(트랜잭션·멱등·감사).
- 흡수: 제안서(FK + 링크 백필), 견적(쿼리), 미팅(`MeetingNote` 신규), POC(opt-in FK), 스테이지 이력(쿼리).
- 스키마 보강(추가 전용/Nullable, `prisma db push` 안전).
- 프로젝트 상세 화면 + 대시보드 KPI 연결.

### 범위(Out, 후속)
- Outlook `/me/calendarView`(Calendars.Read) 미팅 자동 수집 — **fast-follow**, MVP 차단요소 아님.
- 346 태스크 후보 → 체크리스트 자동 시드 — 후보-영업기회 링크 검증 후 별도 단계.
- LLM 기반 요약/분류(키 없음 → 전부 규칙 기반).
- 인보이스/정산, RLS 권한 세분화.

---

## 2. 팀 논의 요약

### Red(적대적 검토)
- **#1 리스크 = 멱등성.** `DeliveryProject.opportunityId`는 필수·비유니크·1:N(`schema.prisma:2033`, `@@index` only `:2043`, `Opportunity.deliveryProjects` `:910`). `findFirst-then-create`는 READ COMMITTED 하에서 check-then-act 경합 → 동시/재시도 POST가 중복 프로젝트 생성. `$transaction`은 원자성만 줄 뿐 멱등성을 주지 않으므로 **DB 유니크 제약**이 필요.
- **(R1 철회)** "WON 도달 불가" 주장 철회. WON은 두 경로로 도달 가능(아래 합의 참조). 진짜 결함은 "**전이 가드 부재**".
- **Green의 'P2 트랜잭션에 전부 흡수' 도전(challenge):** 미검증 4개 연결 경로 + 346 태스크 후보를 원자 트랜잭션에 묶는 것은 과설계. 코어 먼저, 자동수집은 P3+.

### Blue(방어/빌더)
- 흡수가 **조용히 0건 흡수**할 위험이 최대. 제안서는 `generateProposal`이 `opportunityId`를 파싱만 하고 버림(`proposal-generator.ts:124` 파싱 → `:143` create에 미포함). 유일한 실제 엣지는 `OpportunityLink(entityType="proposal")`(`mail-candidate-connections.ts:400-404`).
- 전환은 코드베이스 최초의 비테스트 `$transaction` 작성자가 되어야 함. 기존 `updateOpportunity`/`advanceOpportunityStage`(`opportunity-center.ts:128-197`)의 **비트랜잭션 3연속 await**는 따라하면 안 되는 안티패턴.
- 상태 문자열은 대시보드가 exact-match로 파싱(`dashboard/[role]/route.ts:50-53`) → 새 status 값 도입 시 KPI 누락.

### Green(혁신/가치)
- `DeliveryProject`는 **사실상 빈 셸**(id/opportunityId/name/status/3 timestamp + 체크리스트, `customerId`·`projectId`·`summary` 없음, 코드 참조 소수). 따라서 "확장 vs 신규설계"는 마이그레이션 비용이 **동일** → 거짓 트레이드오프.
- **네이밍 위험(high):** 신규 모델을 `Project`로 명명하면 테넌트 루트 `Project`(`schema.prisma:29`, 모든 `projectId`의 출처)와 **충돌**. → `Engagement`로 명명.
- 가치는 전환 버튼이 아니라 **사전 채워진(pre-populated) 워크스페이스**. 단, Red/Blue의 트랜잭션 경계 도전 수용 → 자동수집은 commit 이후 별도 멱등 단계.

### 3팀 합의(convergence)
1. **기존 (빈) `DeliveryProject`를 제자리에서 재설계**하되, 테넌트 루트 `Project`(`schema.prisma:29`)와의 충돌을 피해 **`Engagement`로 리네이밍**. UI 라벨은 "프로젝트".
2. 모든 스키마 변경은 **추가 전용/Nullable**, `prisma db push` 만 사용. `prisma migrate dev` 금지(데이터 리셋 → 1220 메일/636 스레드/1122 후보 소실).
3. 멱등성은 앱 레벨 `findFirst`만으로 불가 → **DB 유니크 제약 + upsert/catch P2002**. 단, 추가 전 라이브 중복 검사.
4. 전환은 **단일 `prisma.$transaction`**. 기존 stage 변형은 템플릿 아님.
5. 제안서 연결이 근본 GAP: FK 추가 + `generateProposal` 영속화 + 링크에서 백필 + 링크는 전이용 read-fallback로 강등.
6. POC는 프로덕션 영업기회 링크 없음 → **opt-in**, `PocProject.opportunityId` 추가 + 백필.
7. 전환 트리거는 **PATCH `{action:"convert_to_project"}`** (라우트가 PATCH+action 기반, POST 핸들러 없음 → 계획서 §6 POST는 404).
8. `MeetingNote`는 유일한 진짜 신규 테이블. 규칙 기반 키워드 승격, `status="suggested"`, 절대 요약 날조 금지, 트랜잭션 외부 실행.
9. 전환은 **기존 status 값(`planned`)** 으로 생성, 출처는 신규 `convertedAt`/`convertedFromStage`로 기록(status 오버로드 금지).

### 남은 이견(이 계획서가 명시적으로 해소)
| 이견 | 입장 | 본 계획 결정 |
|---|---|---|
| 모델명 | Green: `Engagement` / Blue R1: `DeliveryProject` 유지 | **`Engagement`로 리네이밍** (§3 결정 A) |
| POC FK | Red: P1 필수(또는 컷) / Blue·Green: opt-in nullable | **nullable FK 추가 + 백필, 흡수는 opt-in** (§3 결정 D) |
| 제안서 `deliveryProjectId` | Red R1: 드롭 / Blue: result 엣지로 유지 | **유지** — `opportunityId`=흡수 source, `engagementId`=흡수 result (역할 분리) |
| 자동수집 시점 | Green: P2 트랜잭션 내 / Red·Blue: commit 후 별도 단계 | **commit 후 별도 멱등 단계(P5)** |
| 미팅내용 | Red R1: MVP에서 컷(C2 blob) / Blue·Green: `MeetingNote` 유지 | **`MeetingNote` 유지 + `@@unique` dedupe 키** (§6) |
| convert 게이트 | hard WON gate vs pre_engagement | **pre_engagement 정식 플로우 + 가드 테스트** (§3 결정 E) |

---

## 3. 확정 설계 결정

### 결정 A — "프로젝트" 엔티티 = **`DeliveryProject`를 제자리 재설계 후 `Engagement`로 리네이밍** ✅ 해소
- **근거:** `DeliveryProject`(`schema.prisma:2031-2045`)는 빈 셸이라 "확장"과 "신규설계"의 db push 비용이 동일(Green). 신규 `Project` 명명은 테넌트 루트 `Project`(`:29`)와 충돌(3팀 합의). 두 사실을 동시에 만족하는 유일 해는 **빈 모델을 재설계하면서 `Engagement`로 개명**.
- **리네이밍 영향 동시 처리(필수):** `DeliveryProject`를 참조하는 코드를 같은 변경으로 갱신해야 db client가 깨지지 않음:
  - `apps/web/src/app/api/dashboard/[role]/route.ts:48,73`(`prisma.deliveryProject.findMany`)
  - `Opportunity.deliveryProjects` 역참조 관계명(`schema.prisma:910`)
  - apps/api 라우터(`dashboard.router.ts`, `business.router.ts`의 `deliveryProject.update`)
  - `DeliveryChecklistItem.delivery` 관계(`schema.prisma:2054`)
- **테이블 매핑:** `@@map("delivery_projects")` 유지(물리 테이블 보존, db push 무손실). Prisma 모델명만 `Engagement`.
- ✅ **사용자 확정:** "프로젝트" = **(b) 딜 워크스페이스**. 단, 시작점은 수주(WON)가 아니라 **POC 계획 고객사 확정**(§1 정의, 결정 E). 프로젝트는 POC 확정 → 협상 → 수주 → 딜리버리까지 하나의 워크스페이스로 이어진다.

### 결정 B — 흡수 방식 = **링크 보존 + 직접 FK 병행(재귀속 아님)**
- 원본은 영업기회에 남기고, 자식의 신규 nullable FK(`engagementId`)를 set(re-parent는 가역적 — FK null로 undo 가능). `OpportunityLink` 행은 절대 삭제하지 않음(감사 추적).
- 제안서: `GeneratedDocument.opportunityId`=**흡수 source of truth**, `engagementId`=**흡수 result**. 둘은 경쟁 진실이 아니라 역할 분리.
- 견적·스테이지 이력: 이미 `opportunityId` 스코프 → **쿼리로만 흡수**(마이그레이션 불필요).

### 결정 C — 멱등성 = **DB 유니크 제약 + `$transaction` (둘 다 필수)**
- `$transaction`=원자성, `@unique`=멱등성. 별개 문제이며 둘 다 필요(Red).
- `Engagement`는 빈 테이블이므로 **재설계 시점에 `opportunityId @unique`를 born-in**으로 추가 → Red의 "라이브 중복 검사 후 추가" 우려가 구조적으로 무력화(Green). 단 안전을 위해 push 전 `groupBy(opportunityId) having count>1` 1회 확인.
- 1:N(수동 생성 프로젝트)을 유지해야 한다면 대안: 별도 `convertedFromOpportunityId String? @unique`. **본 계획은 1:1 전환 가정 → `opportunityId @unique` 채택.** (⚠️ 수동 다중 프로젝트 요구가 있으면 대안으로 전환.)

### 결정 D — POC 흡수 = **opt-in** ✅ 해소
- 사실: `PocProject`에 `opportunityId` 없음(`schema.prisma:787-816`). `createPocProject`는 `OpportunityLink`를 만들지 않고 `logStateTransition(entityType:"poc_project")`(상태로그 네임스페이스, `poc-center.ts:97`)만 기록.
- 정정: `entityType="poc"`는 **테스트 전용이 아님** — `addOpportunityLinkSchema` enum(`opportunity-center.ts:56`) + `enrichOpportunityLinks` read(`:243`)로 프로덕션 지원. 즉 `add_link` action으로 수동 링크 생성 가능. 다만 **자동 생성 경로가 없어** 기존 데이터에는 링크가 거의 없음.
- 결정: `PocProject.opportunityId String?` nullable 추가 + 48개 mail POC 후보의 `connectionResult` 메타에서 백필. 흡수는 (1) 명시적 `OpportunityLink(entityType="poc")` (2) 신규 FK 둘 다 읽되, **"전환 시 자동 POC 흡수가 동작한다"고 주장하지 않음**(백필·going-forward 링크 작성 전까지).

### 결정 E — 전환 게이트 = **"POC 계획 고객사 확정" 이벤트** ✅ 해소(사용자 정의 반영)
- **트리거(사용자 확정):** WON이 아니라 **고객사 미팅 후 POC 계획을 고객사와 확정한 시점**에 전환한다. 따라서 전환은 통상 `POC` 단계(또는 그 직전 `PROPOSAL`)에서 발생하며, 수주(WON)는 프로젝트 내부의 후속 마일스톤이 된다.
- **"확정"의 표현(휴먼 판단):** "POC 계획을 고객사와 확정"은 사람이 누르는 명시적 액션이다 → 전환은 **PATCH `{action:"convert_to_project"}`** 수동 트리거(§7). 자동 점프 금지.
- **가드(결정론적):**
  - 사실: `updateOpportunity`(`opportunity-center.ts:128-166`)는 `stage`를 enum 검증만 하고 전이 가드가 없어 임의 단계 점프가 가능하므로, 게이트는 stage 값에 의존하지 않고 **전환 함수 내부에서 명시 검증**한다.
  - 권장 가드: `stage ∈ {PROPOSAL, POC, NEGOTIATION, WON}` 그리고 **연결된 POC가 존재**(POC 계획 확정의 증거)할 때만 허용. POC 미연결 시 `force` 플래그로만 허용하고 경고 기록.
  - 생성 status: POC 확정 시점(보통 WON 전) → `pre_engagement`, 이미 WON이면 `planned`. 전환 시점 단계는 `convertedFromStage`에 기록.
- 테스트: "어떤 단계/POC유무에서 어떤 status로 생성되는지" 결정론적 단언(P6).

---

## 4. 데이터 모델 변경 (Prisma, 실제 필드명)

> 전부 **추가 전용/Nullable**, `prisma db push` 적용. `prisma migrate dev` 금지.

### 4.1 `DeliveryProject` → **`Engagement`로 리네이밍 + 필드 추가**
```prisma
model Engagement {
  id                 String    @id @default(cuid())
  opportunityId      String    @unique @map("opportunity_id")   // 결정 C: 멱등 DB 가드
  projectId          String?   @map("project_id")               // 결정: Opportunity.projectId 복사(테넌트 스코프)
  customerId         String?   @map("customer_id")              // 영업기회에서 복사
  name               String
  status             String    @default("planned")             // planned/sow_pending/in_progress/delayed + pre_engagement
  amount             Decimal?  @db.Decimal(12, 2)               // 결정 #3: 최신 확정(비-draft) Quote 금액 스냅샷
  amountQuoteId      String?   @map("amount_quote_id")          // 금액 근거 Quote 추적
  summaryMarkdown    String?   @map("summary_markdown")
  convertedAt        DateTime? @map("converted_at")
  convertedFromStage String?   @map("converted_from_stage")
  sowApprovedAt      DateTime? @map("sow_approved_at")
  startedAt          DateTime? @map("started_at")
  completedAt        DateTime? @map("completed_at")

  opportunity     Opportunity            @relation(fields: [opportunityId], references: [id])
  checklistItems  DeliveryChecklistItem[]
  generatedDocuments GeneratedDocument[]                        // 흡수 result 역참조
  meetingNotes    MeetingNote[]

  @@map("delivery_projects")  // 물리 테이블 보존
}
```
- ⚠️ `opportunityId @unique`로 변경 = `Opportunity.deliveryProjects DeliveryProject[]` 역참조도 1:1로 변경(`Engagement? engagement`). push 전 라이브 중복 1회 검사(결정 C).

### 4.2 `GeneratedDocument`(제안서) 필드 추가 — 근본 GAP 닫기
```prisma
  opportunityId String? @map("opportunity_id")   // 흡수 source of truth
  engagementId  String? @map("engagement_id")    // 흡수 result(re-parent)
  // @@index([opportunityId]) 추가
```
- **동시 수정 필수:** `generateProposal`(`proposal-generator.ts:143-152`)의 create에 `opportunityId: parsed.opportunityId` 추가(현재 `:124`에서 파싱만 하고 버림).
- **백필:** 기존 `OpportunityLink(entityType="proposal")` 행(`mail-candidate-connections.ts:400-404`) → `GeneratedDocument.opportunityId` 1회 백필. 이후 링크는 read-fallback로 강등.

### 4.3 `PocProject` 필드 추가 (결정 D)
```prisma
  opportunityId String? @map("opportunity_id")
  // @@index([opportunityId]) 추가
```
- 백필: 48개 mail POC 후보 `metadata.connectionResult`. going-forward로 `createPocProject` 또는 `approveAndConnectMailCandidate`에서 set(후속).

### 4.4 신규 `MeetingNote` (유일한 진짜 신규 테이블, §6)
```prisma
model MeetingNote {
  id                 String    @id @default(cuid())
  opportunityId      String?   @map("opportunity_id")
  engagementId       String?   @map("engagement_id")
  customerId         String?   @map("customer_id")
  title              String
  occurredAt         DateTime? @map("occurred_at")
  attendees          String[]
  bodyMarkdown       String    @map("body_markdown")
  source             String    @default("manual")            // manual/mail/calendar
  status             String    @default("suggested")         // suggested/confirmed
  mailInsightThreadId String?  @unique @map("mail_insight_thread_id")  // 승격 dedupe 키
  createdAt          DateTime  @default(now()) @map("created_at")

  @@index([opportunityId])
  @@index([engagementId])
  @@map("meeting_notes")
}
```
- `@@unique([mailInsightThreadId])` → 재전환/재동기화 시 스레드 중복 승격 방지(upsert).

---

## 5. 전환·흡수 로직 (트랜잭션·멱등·감사)

### 5.1 신규 `packages/business/src/engagement-center.ts`
```ts
convertOpportunityToProject(opportunityId, opts?: {
  name?: string
  absorb?: { proposals?: boolean; poc?: boolean; quotes?: boolean; meetings?: boolean }
}): Promise<{ engagement, absorbed: { proposals: n, poc: n, quotes: n, meetings: n } }>
```

### 5.2 절차 — 단일 `prisma.$transaction`
1. **검증:** 영업기회 존재(`projectId`·`customerId` 확보), 전환 단계 기록용 stage 읽기. POST 본문이 cross-customer를 강제하지 않도록 자식들이 영업기회의 `customerId`를 공유하는지 검증(`mail-candidate-connections.ts:330-378`의 customer_mismatch 가드 패턴 미러).
2. **멱등 가드(2중):**
   - 트랜잭션 내 `tx.engagement.findFirst({ where: { opportunityId } })` → 있으면 즉시 반환(re-convert no-op).
   - 그래도 동시 INSERT 경합은 `@unique(opportunityId)`가 **P2002로 차단** → catch 후 기존 행 재조회 반환.
3. **Engagement 생성:** `tx.engagement.create({ opportunityId, projectId: opp.projectId, customerId: opp.customerId, name, status: stage==="WON" ? "planned" : "pre_engagement", convertedAt: now, convertedFromStage: opp.stage, summaryMarkdown })`.
4. **흡수(검증된 엣지만, 전부 tx 클라이언트 사용):**
   - **제안서:** `GeneratedDocument.opportunityId == opp.id` **UNION** `OpportunityLink(entityType="proposal")` 경유 문서(백필 완료 검증 전까지 UNION). 각 문서 `engagementId` set. **모든 쿼리는 `opp.projectId`로 스코프.**
   - **견적/금액(결정 #3 확정):** `Quote(opportunityId == opp.id)` 중 **최신 비-draft 버전**을 선택(전 행 합산 금지 — `Quote.version`/`status` 다중 행 이중계상 위험), 그 금액을 `engagement.amount` + 근거 `amountQuoteId`에 기록. 비-draft Quote가 없으면 `null`(견적 미확정 표시), `Opportunity.amount`로 폴백하지 않음(견적 변경 미반영 방지).
   - **POC(opt-in):** `OpportunityLink(entityType="poc")` + `PocProject.opportunityId` 백필분만 `engagementId`로 연결. 기본 경로에서 "자동 흡수 성공" 주장 안 함.
   - **미팅:** `MeetingNote(opportunityId == opp.id)`를 `engagementId`로 연결.
5. **감사:** `OpportunityStageEvent`(`note:"converted_to_project"`) + `logStateTransition({ entityType:"opportunity", metadata:{ engagementId } })`. 원천 `MailDerivedCandidate.metadata.connectionResult`에 `engagementId` 기록(존재 시).
6. **금지 사항:** `addOpportunityLink`(자체 커넥션 오픈) 호출 금지 — tx 클라이언트를 헬퍼에 주입. 기존 `updateOpportunity`/`advanceOpportunityStage`의 비트랜잭션 3연속 await 패턴 복사 금지.

### 5.3 멱등성/롤백
- re-convert는 기존 engagement 반환(중복 생성 금지) — DB `@unique`로 보장.
- 자식 흡수는 **upsert/FK set(가역)** → 부분 실패 시 트랜잭션 롤백, 재시도 시 동일 결과.
- 흡수 쿼리는 항상 **`Opportunity.projectId`(실 테넌트 컬럼, `schema.prisma:890`)로 스코프** — `GeneratedDocument`·`Engagement`는 자체 테넌트 컬럼이 없으므로 문서 측을 신뢰하지 않음.

---

## 6. 미팅내용(미팅내용) 흡수 방안

- **모델:** `MeetingNote`(§4.4) — 진짜 없는 유일 테이블(`grep` 결과 어떤 미팅 모델도 없음).
- **소스 ① 수동:** 프로젝트 상세에서 직접 입력(`source="manual"`, `status="confirmed"`).
- **소스 ② 메일 스레드 승격(규칙 기반, no-LLM):** `MailInsightThread`(`schema.prisma:1314`) 중 제목 키워드(미팅/회의/MoM/킥오프/minutes) 매칭 스레드를 `MeetingNote`로 승격. `source="mail"`, `status="suggested"`(휴먼 확인 게이트), `mailInsightThreadId` 포인터. **절대 요약 날조 금지** — 스레드가 source of truth, MeetingNote는 view/pointer.
- **멱등:** `@@unique([mailInsightThreadId])` + upsert → 재전환/재동기화 시 중복 노트 방지.
- **실행 위치:** **전환 트랜잭션 외부, commit 후 별도 멱등 단계(P5)** — 노이지한 규칙 분류기가 전환을 롤백하지 못하게.
- **소스 ③ 캘린더(후속/fast-follow):** Outlook `/me/calendarView`(Calendars.Read 보유, `outlook-sync.ts:39`는 app-level `.default` 사용 — 위임 스코프 리팩터 필요). `occurredAt`/`attendees` 채움. **MVP 차단요소 아님**, 자체 검증 동반 별도 에픽.

---

## 7. API 설계

| 메서드/경로 | 동작 | 비고 |
|---|---|---|
| `PATCH /api/opportunities/[id]` `{action:"convert_to_project"}` | `convertOpportunityToProject(id)` | **PATCH dispatcher에 분기 추가**(`route.ts:27-52`의 advance/add_link 패턴). 기존 try/catch + `serializeDecimalAtBoundary`(amount=Decimal) 재사용. ~~POST~~ 금지(404). |
| `GET /api/engagements` | 프로젝트 목록(영업기회/고객/흡수 카운트) | 신규 컬렉션 라우트 |
| `GET /api/engagements/[id]` | 상세 — 흡수된 제안서/POC/견적/미팅/체크리스트 집계 | |
| `PATCH /api/engagements/[id]` | 상태/체크리스트 갱신 | status 값은 기존 버킷 존중 |
| `POST /api/engagements/[id]/meetings` | `MeetingNote` 추가/메일 스레드 승격 | |

---

## 8. UI 설계

- **영업기회 상세**(`/opportunities/[id]`): **"프로젝트로 전환"** 버튼. WON이면 즉시 전환, WON 전이면 "사전 프로젝트(pre_engagement)로 시작" 확인 모달. 전환 후 프로젝트로 이동.
- **프로젝트 상세**(신규 `/engagements/[id]`, UI 라벨 "프로젝트"):
  - 헤더: 고객/금액(최신 견적)/원 영업기회 링크/status(pre_engagement 뱃지 포함).
  - 섹션: **제안서**(버전) · **POC**(체크리스트·이슈·결과리포트, opt-in 링크) · **미팅내용**(타임라인, suggested 노트는 "검토 필요" 표시) · **견적** · **딜리버리 체크리스트**.
- **Delivery/Operator 대시보드**(`dashboard/[role]/route.ts:50-53`): 전환된 프로젝트가 `planned` 버킷에 정상 집계되도록 status=`planned`로 생성. **`pre_engagement`는 같은 PR에서 신규 명시 버킷 추가** + 테스트(미추가 시 KPI에서 조용히 누락).

---

## 9. 단계별 구현 계획

| 단계 | 내용 | 핵심 산출물 | 위험 게이트 |
|---|---|---|---|
| **P1** | 스키마 보강(§4): `DeliveryProject`→`Engagement` 리네이밍+필드, `GeneratedDocument.opportunityId/engagementId`, `PocProject.opportunityId`, 신규 `MeetingNote`. `db push`. 리네이밍 call-site 동시 갱신(§3-A). | 스키마, 새 client | push 전 `groupBy(opportunityId)` 중복 검사 |
| **P2** | `generateProposal` `opportunityId` 영속화 + `OpportunityLink(proposal)`→`GeneratedDocument.opportunityId` 1회 백필. POC FK 48건 백필. | 백필 스크립트(멱등) | FK count vs link count 일치 검증 |
| **P3** | `engagement-center.ts` `convertOpportunityToProject`(단일 `$transaction` + `@unique`/P2002 멱등 + 검증된 엣지 흡수 + 감사). | 전환 코어 | tx 클라이언트 주입, addOpportunityLink 미사용 |
| **P4** | API(§7): PATCH action 분기 + `/api/engagements` 라우트. UI: 전환 버튼 + 프로젝트 상세. 대시보드 `pre_engagement` 버킷. | 라우트/페이지 | status 문자열 호환 테스트 |
| **P5** | 미팅 승격(§6 소스②): commit 후 멱등 단계, 키워드 룰, `@@unique` upsert, status=suggested. | 승격 함수 | 트랜잭션 외부 실행 검증 |
| **P6** | 통합 테스트(`phase12-poc-opportunity.test.ts`처럼 gated): 영업기회+제안서1+견적1+미팅1 시드 → convert 2회 → **정확히 1개 Engagement, 2회차 동일 id, absorbed {proposals:1,quotes:1,meetings:1}**, FK-count vs link-count 일치. 대시보드 KPI 연결. | E2E 리포트 | 중복-프로젝트·빈-흡수 두 회귀가 CI fail |
| **P7(후속)** | 캘린더 수집(`/me/calendarView`), 346 태스크 후보→체크리스트 시드(링크 검증 후). | — | 별도 에픽 |

---

## 10. 리스크·미해결 이슈

| 리스크 | 심각도 | 완화 |
|---|---|---|
| 동시/재시도 전환 → 중복 프로젝트, 제안서 이중 흡수, 대시보드 KPI 부풀림(`route.ts:48`은 dedup 없는 `findMany`) | High | `Engagement.opportunityId @unique` + P2002 catch. 대시보드 dedup은 유니크로 자동 해결 |
| 흡수 0건(제안서 FK 미백필, POC 링크 없음) → 빈 프로젝트인데 "성공" | High | FK+링크 UNION 읽기, P2 백필 후 FK 단독, P6 count 단언으로 CI fail |
| 비원자 전환 → half-absorbed 셸 | High | 단일 `$transaction`, 헬퍼에 tx 주입 |
| `db push`로 `@unique`/리네이밍 시 라이브 중복·call-site orphan | Med | push 전 중복 검사, 리네이밍 call-site 동시 갱신(§3-A) |
| 신규 status(`pre_engagement`)가 대시보드 exact-match 버킷에서 누락 | Med | 같은 PR에 버킷 추가 + 테스트 |
| cross-tenant 흡수(문서 측 `projectId` 없음) | Med | `Opportunity.projectId`로만 스코프, customer 공유 검증 |
| 규칙 기반 미팅 승격 노이즈 | Low | status=suggested 휴먼 확인, pointer-only |
| 견적 금액 이중계상(`Quote.version`/draft 다중 행) | Low | 최신 비-draft 버전만 사용 |

### 미해결(사용자 결정 필요) ⚠️
1. ~~**"프로젝트" 정의**~~ ✅ **확정**: (b) 딜 워크스페이스, 전환 게이트 = **POC 계획 고객사 확정**(§1, 결정 E). 기회 = 고객사+견적서 요청.
2. ~~**1:1 vs 1:N**~~ ✅ **확정**: 1기회=1프로젝트 → `Engagement.opportunityId @unique`(결정 C), `Opportunity.engagement Engagement?` 1:1 역참조.
3. ~~**프로젝트 amount 정의**~~ ✅ **확정**: **최신 비-draft `Quote`** 금액 스냅샷(`engagement.amount`/`amountQuoteId`, §5.2-4). 견적 없으면 null.
4. **미팅 승격 신뢰 임계**: suggested 자동첨부 vs 명시 승인.
5. **캘린더 수집(`/me/calendarView`, `.default`→위임 스코프 리팩터)** 본 피처 범위 vs 별도 에픽.
6. **POC FK going-forward**: `createPocProject`/`approveAndConnectMailCandidate`가 링크를 자동 작성하도록 패치할지.

---

## 11. 다음 액션

1. 미해결 이슈 #1·#2·#3 확정(특히 1:1 vs 1:N, "프로젝트" 정의) — P1 착수 전 필요.
2. **P1 착수:** 스키마 보강 + 리네이밍 call-site 동시 갱신 + push 전 중복 검사.
3. **P2:** `generateProposal` 영속화 패치 + 제안서/POC 백필 스크립트(멱등).
4. **P3:** `convertOpportunityToProject` 코어 + P6 통합 테스트를 함께 작성(멱등·비-0 흡수 회귀를 CI에 고정).
