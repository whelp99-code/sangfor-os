This is a final editing/synthesis task — I need to produce the polished masterplan as my output. The draft is already thoroughly verified through 3 rounds. My job is to refine it into a clean, final Korean markdown document following the 10-section structure requested. Let me produce it directly.

# Sangfor Agentic OS 전면 개선 마스터플랜

> **검증 표준**: 모든 정량 주장은 측정 커맨드 + HEAD `ffad361` 기준. 3라운드 비판을 거치며 5개 핵심 항목을 코드로 재반증·정정함(아래 각주). 실행팀은 본 문서를 그대로 따를 수 있도록 작성됨.
>
> **3라운드에서 코드로 재반증·정정된 5개 항목**
> ① **G1의 진짜 결함은 "축 불일치"가 아니라 `demo-project` 단일테넌트 하드코딩** — `grep -rn demo-project packages/business/src`=20곳, `resolveDomainProjectId(slug="demo-project")`(domain-memory.ts:83). 쓰기·읽기 둘 다 demo-project 한 행으로 붕괴 → "동일 스코프 집계" e2e는 *이미 통과하는 가짜 게이트*였다.
> ② **학습 루프는 라이브가 아니라 끊겨 있다** — `upsertDomainMemory`가 `tags` 미주입(project-decision.ts:40~50) → 저장 `tags:[]`(domain-memory.ts:105 default) → `scoreDomainMemory`가 `query.tags.length===0 ‖ overlap===0`이면 0 반환(domain-memory.ts:52,56). **인간 교정은 영구 recall 0점.** Round 2의 P0-1 강등을 **철회**한다.
> ③ **rejected 가중이 +0.3 양수**(domain-memory.ts:42) → 거절 패턴이 계속 추천됨. 음의 학습 부재.
> ④ **`@sangfor/ui`에 EmptyState/ErrorState/Toast/Skeleton 포함 13개 컴포넌트가 *이미 존재*하나 web import 0** (`ls packages/ui/src`=13, `grep @sangfor/ui apps/web`=0). "신규 구축"이 아니라 **채택 감사 + 결선**이다.
> ⑤ **포털엔 loading/error·편집폼 전무, CFO에만 존재** — 편집은 어포던스 문제가 아니라 폼 자체가 0개. 정량 정정: migration **18**, package **16**, cfo-hex(theme 파일) **8**, ui 컴포넌트 **13**·import **0**, demo-project grep **20곳**. kill-switch·rollback·outbox·provenance 동결 = 전부 부재(검증됨).

---

## 1) 비전 · 목표

### 1.1 비전

베를로(sangfor-os)는 **한국 B2B 총판의 "견적 → 발행 → 손익"이 끊김 없이 *인용체인(citation chain)*으로 이어지는 단일 정본 축을 한국 세무에 그라운딩해 제공하고, 그 위에서 도메인 × 색렌즈 에이전트가 사람의 승인 이력을 학습해 액션별로 자율도를 졸업하는 Agentic OS**다.

해자(moat)는 복호화 트릭(SEED + MD5, 누구나 3주면 복제)이 *아니라*:
- **① 통합 축** — 메일 → 영업기회 → 딜리버리 → 세금계산서/CFO를 잇는 단일 정본 축
- **② 데이터 플라이휠** — 그 위에 누적되는 승인이력 · 도메인 메모리

이 둘만이 글로벌 SaaS(HubSpot/Clay/n8n)도 로컬 세무 SW(더존/Popbill)도 동시에 줄 수 없는 가치다.

### 1.2 현실 직시 (자기진단의 정직화)

백엔드 자산(직교 도메인 런타임 · 손익뷰 · 보안메일 복호화)은 강하다. 그러나 **자기 진단조차 부정직했다**:
- "학습 루프 라이브"는 **거짓**이었다 (tags 미주입 → recall 영구 0점).
- 모든 결정이 `demo-project` 단일 행으로 붕괴 중이다.
- KPI는 리터럴(`renewalsDue:0`), AI 명령 진입점은 가짜(`console.log`), 앱은 read-only다.

### 1.3 목표

본 플랜은 **쐐기(wedge) 1개를 선언하고, 끊긴 학습 루프를 봉합하고, 차별화를 deep하게 당기고, 측정을 처음부터 박는다.** 구체 목표:

1. **봉합** — `demo-project` 단일테넌트 붕괴와 끊긴 학습 루프를 토대 레벨에서 복구.
2. **쐐기** — "한국 총판의 세무-그라운딩 영업→발행 파이프라인" 1개로 좁혀 best-in-class.
3. **deep 차별화** — thin 1건 데모가 아니라 N건 배치 + 예외큐 + 정확도지표(minimum-operational).
4. **측정** — 북극성 4지표를 Phase 0에 베이스라인으로 찍고 모든 Phase 완료기준에 Δ.
5. **안전** — 비가역(세금계산서 발행)을 3단계로 타입화, kill-switch를 자동행위보다 먼저.

---

## 2) 핵심 설계 원칙

1. **검증 위에서만 "검증됨"을 쓴다.** 모든 정량 주장에 측정 커맨드 + HEAD를 단다. Round 2는 자기 정정조차 코드와 어긋났다 — 이 라운드는 5개 반증을 직접 grep으로 재확인했다.
2. **쐐기 우선, 풀스택은 PMF 뒤.** "총판 업무 전부"는 어느 것도 best-in-class가 아니게 만든다. 쐐기 = **"한국 총판의 세무-그라운딩 영업→발행 파이프라인"**. 인증·폰트·패키지분할·다크모드는 쐐기 검증 전엔 과잉설계.
3. **학습은 *읽혀야* 학습이다.** 교정이 recall로 돌아오지 않으면 자율도는 연극이다. 단일 태그 어휘(vocabulary)·음의 학습·콜드스타트 시드를 토대로 깐다.
4. **비가역은 토대다 — 3단계로 타입화.** 가역(즉시+Undo) / 지연가역(outbox N초 보류) / **비가역**(세금계산서 발행=Undo 어휘 금지, "발행 전 게이트" + "취소발행 발의"만). 전역 kill-switch가 자동행위보다 먼저 온다.
5. **측정 없이 결선 금지.** 북극성 4지표(승인소요시간·자동처리율·발행오류율·재방문)를 Phase 0에 베이스라인으로 찍고, 모든 Phase 완료기준에 "지표 Δ"를 단다.

---

## 3) 현재 상태 요약 — 5관점 갭 매트릭스

> 관점 = {아키텍처, AX(에이전트 경험), 제품, UX, 디자인}. 모든 갭에 검증 각주(HEAD `ffad361`).

| # | 갭 | 관점 | 증거 (HEAD ffad361) |
|---|---|---|---|
| **G1** | **`demo-project` 단일테넌트 하드코딩** — 모든 결정·메모리가 한 행으로 붕괴 | 아키·AX·제품 | `grep -rn demo-project packages/business/src`=20곳; `resolveDomainProjectId(slug="demo-project")` domain-memory.ts:83; `recordHumanDecision`은 projectSlug 미전파(project-decision.ts:22~) |
| **G2** | **학습 루프 끊김** — 인간 교정이 recall 영구 0점 | AX | `upsertDomainMemory`에 tags 미주입(project-decision.ts:40~50) → `tags:[]`(domain-memory.ts:105) → `scoreDomainMemory`가 `overlap===0`이면 0(:52,:56); rejected 가중 +0.3 양수(:42) |
| **G3** | **위험 토대 4종 + kill-switch 부재** — Undo·롤백률·provenance 동결·승인자 신원·전역정지 | AX·제품 | `grep killSwitch‖rollback‖outbox‖revertedAt`=0; `computeAutonomy` 단일 비율·min sample 3(project-decision.ts:66,75); MOCK_USER |
| **G4** | **대시보드 KPI 리터럴 + 측정 토대 0** | 제품·아키 | `renewalsDue:0`(dashboard/[role]/route.ts:20); 북극성 집계 없음 |
| **G5** | **앱이 read-only** — 편집·삭제 UI 전무(어포던스 아님, 폼 자체 0) | UX | opportunities/poc/knowledge에 `onSubmit‖PATCH`=0건; 포털 loading/error=0(CFO만 존재) |
| **G6** | **AI 명령 진입점 가짜 + ⌘K 탐색 인덱스 부재** | 제품·UX | 가짜 Cmd+K dispatch, `handleCommand`=console.log; 전역 검색 인덱스 없음·`/knowledge-search` 고아 |
| **G7** | **카테고리 미결정** — 60라우트·38nav는 IA 문제가 아니라 쐐기 미선언의 증상 | 제품·UX | nav 38·라우트 60·고아쌍 4; 5개 카테고리 기능 동시 시도 |
| **G8** | **시각 시스템 역순 + 13컴포넌트 0-import + lang=en** | 디자인·UX | `ls packages/ui/src`=13(EmptyState 등 이미 존재)·web import 0; globals.css 124변수 미분류·다크참조 2건; `lang="en"`+Geist |

### 관점별 한 줄 요약

- **아키텍처**: 두 번째 진실원천(tRPC 10라우터 vs web REST) 미판정, FK 정합화 미완(Engagement.projectId? nullable), 18 마이그레이션 무결성 미실측.
- **AX**: 학습 루프 끊김(G2)이 모든 자율도 약속의 진위를 무너뜨림. 멱등·신원·provenance·kill-switch 전부 부재(G3).
- **제품**: 쐐기 미선언(G7)이 60라우트의 원인. 측정 토대 0(G4)으로 "더 나아졌나?"를 못 답함.
- **UX**: read-only(G5) + 가짜 명령바(G6) → 데모 즉시 들통. 받은편지함/My Work 분리 시 길 잃음.
- **디자인**: 시각 시스템 역순(G8) — 컴포넌트를 먼저 찍으면 전량 retro-fit. 한글 데모인데 lang=en + Geist.

---

## 4) 채택할 외부 best-practice (출처)

| 영역 | 채택 원칙 | 출처/근거 |
|---|---|---|
| **쐐기 전략** | 단일 진입점(wedge)으로 좁혀 best-in-class 후 확장 | Geoffrey Moore *Crossing the Chasm*; a16z "wedge then platform" |
| **데이터 플라이휠** | 사용→데이터→정확도→사용의 누적 우위가 진짜 해자 | Hamilton Helmer *7 Powers* (Cornered Resource/Scale Economies); CB Insights data-network-effects |
| **HITL 자율도 졸업** | 신뢰는 액션별로 점진 졸업, 항상 retract 가능 | Anthropic/OpenAI agent safety guidance; "graduated autonomy" HITL 패턴 |
| **통계적 보수성** | 소표본 비율은 윌슨 점수 하한으로 (3건 100% ≠ 졸업) | Wilson score interval (Evan Miller "How Not To Sort By Average Rating") |
| **비가역 액션 안전** | Undo 불가 액션은 outbox 지연 + 발행 전 게이트로 타입화 | Gmail "Undo Send" outbox 패턴; Google SRE *Error Budgets*; idempotency keys (Stripe API) |
| **명령 팔레트** | ⌘K는 탐색 인덱스 선행, 명령은 골든패스 1건으로 좁힘 | Linear/Raycast/Superhuman CommandK; "search-first then command" |
| **디자인 토큰 2계층** | primitive → semantic 토큰, 8px 그리드, 타입스케일 ratio | Salesforce Lightning Design Tokens; Material 3; Tailwind spacing scale |
| **한글 타이포** | Pretendard self-host(woff2 서브셋)로 CLS·정체성 확보 | Pretendard(orioncactus) OSS; web-font subsetting best practice |
| **빈/오류/로딩 상태** | EmptyState/ErrorState/Skeleton을 primary-action 슬롯과 함께 | Nielsen Norman Group empty-state UX; Next.js App Router loading.tsx/error.tsx 규약 |
| **고밀도 데이터 테이블** | tabular-nums 우정렬 + compact/comfortable 밀도 토큰 | Carbon/Ant Design DataTable; financial-grade table density |
| **provenance/감사** | 결정 시점 입력의 immutable snapshot + deterministic replay | Event sourcing(Fowler); ML lineage(MLflow/W&B) |
| **soft-delete** | `deletedAt` + 전역 read 미들웨어 + 영향 미리보기 | Prisma soft-delete middleware 패턴; "show blast radius before destructive op" |

---

## 5) 개선 작업 백로그 (P0/P1/P2)

> 표기: **무엇 / 가치 / 영향영역 / 난이도 / 의존 / 관점**. 난이도 = S(소)·M(중)·L(대).

### P0 — 토대 봉합 + 쐐기 + 측정 + 비파괴 첫인상

| ID | 무엇 | 가치 | 영향영역 | 난이도 | 의존 | 관점 |
|---|---|---|---|---|---|---|
| **P0-W** | **쐐기·카테고리·경쟁 매트릭스 1페이지** — "우리는 ___ 카테고리에서 ___로 이긴다, vs Clay/n8n/더존/Popbill은 ___를 못 한다"를 못 쓰면 *코딩 금지*. 기각 기능 목록(무엇을 *안* 만드는가)+데모 헤드라인. 해자="복호화"가 아니라 "통합 축+데이터 플라이휠"로 명문화 | 카테고리 미결정이 60라우트의 *원인*. 모든 우선순위의 상위 게이트 | 문서 | S | 없음(최우선) | 제품 |
| **P0-0** | **`demo-project` 제거 + projectId 전파** — `resolveDomainProjectId`의 `slug="demo-project"` 디폴트 **삭제→미지정 시 throw**. `recordHumanDecision`/`recordDomainDecision`이 라우트에서 실 `projectId`를 engagement→opportunity→project 체인으로 해석(domain-proposal.ts:152 패턴 재사용)해 끝까지 전파. 정본 축 ERD+join 매트릭스. **기존 `DomainDecisionLog` 행 re-attribution dry-run**(P0-3 마이그레이션과 동일 트랜잭션). `caseRef`는 *라벨*임 명시 | 모든 결정이 한 행으로 붕괴 중 — 자율도·멀티테넌트의 첫 줄 | domain-memory.ts:83, project-decision.ts, schema.prisma, 신규 migration | M | 없음 | 아키·AX |
| **P0-1** | **학습 루프 봉합 — recall 어휘 결선 (Round2 강등 철회)** — ① `upsertDomainMemory`에 `tags=[domain,entityType,intentTag]` 주입(현재 미주입→영구 0점). ② recall 질의 태그(domain-proposal.ts:96 `[domain,engagementName]` 노이즈)와 저장 태그를 **단일 vocabulary**로 정렬. ③ `source="human"` outcome 가중 상향. ④ rejected를 **negative exemplar(감점/제외)**로 전환(현재 +0.3 양수) | 인간 교정이 다음 동종 제안에 주입돼야 자율도가 진짜. **P3 자율도 다이얼 전체의 진위** | project-decision.ts, domain-memory.ts, domain-proposal.ts | M | P0-0 | AX |
| **P0-2** | **승인 무결성 — 페이로드+멱등+승인시점 검증** — `LaneDecisionControls`가 `proposalId`+`output{title,bodyMarkdown}`+구조화 `humanEdit{field,before,after}` 전송(현재 `{note}`만, :57). route에 `(domain,caseRef,decisionType)` 유니크+제안별 outcome 1회(중복=409). **승인 제출 시 클라가 본 `evidenceHash` 동반→서버 현재 상태 불일치 시 "내용 변경됨, 재검토" 게이트** | 더블클릭 승인=결정 2행→자율도 분모 오염→거짓 졸업(자기강화 루프) | lane-decision-controls.tsx, domain-decision/route.ts, project-decision.ts | M | P0-0 | AX·아키 |
| **P0-3** | **결정 텔레메트리 스키마 + computeAutonomy 보수화** — `DomainDecisionLog`에 `actionType`·`revertedAt`·`revertReason`·`modelVersion`·`decidedByUserId` 추가(P0-0 re-attribution과 동일 마이그레이션). `computeAutonomy`를 **윌슨 하한+시간감쇠+actionType 차원**으로 교체(현재 단순비율·min3=100% 졸업 유도). CFO·발행 도메인=`graduationLocked` 영구 플래그 | **신호는 지금 안 쌓으면 백필 불가** | schema.prisma, project-decision.ts | M | P0-0 | AX·아키 |
| **P0-4** | **승인자 신원 + 전역 Kill-switch** — `decidedByUserId`로 쓸 RoleContext userId 주입+dev Role Switcher(플래그 가드). **`AutonomyKillSwitch`(테넌트별 on/off)**: 모든 자동 실행 경로(파이프라인·발송큐·자동승인·자동졸업)가 진입 시 체크. off면 사람 명시행위만 통과 | 책임 주체 없는 게이트는 보안 연극. 자동행위 들어오기 *전에* 정지 수단 | permissions.ts, portal-shell.tsx, domain-agent-runtime.ts | S~M | 없음 | AX·제품 |
| **P0-5** | **Evidence provenance 동결(생성)** — `domain-proposal.ts`가 제안 *생성 시* `proposalSnapshot`(인용 메일 line id, recall hit ids+confidence, 정책버전, 손익 입력값)을 immutable JSON 동결. 승인 시점 일치 검증은 P0-2의 evidenceHash. 카드는 동결본만 렌더 | "왜 그때 그렇게 판단했나"의 불변 기록 — 생성 코드에 지금 안 넣으면 사후 부착 불가 | domain-proposal.ts, schema.prisma | M | P0-0, P0-2 | AX·제품 |
| **P0-6** | **시각 시스템 5종 동시 확정 (컴포넌트보다 먼저)** — globals.css 124변수→`--color-{primitive}`/`--{semantic}` 2계층 재네이밍+**8px 간격 토큰**+타입스케일(1.2 ratio 6단)+**Pretendard self-host**(woff2 서브셋, `--font-sans` 교체)+**Lucide 아이콘 세트**+반응형/밀도 토큰(compact/comfortable, breakpoint 3단). 메트릭 회귀 스냅샷 | 컴포넌트를 먼저 찍으면 Phase 2에서 전량 retro-fit. 한글 데모 정체성+그리드 메트릭의 전제 | globals.css, tokens.css, layout.tsx, playwright | M~L | 없음 | 디자인 |
| **P0-7** | **색렌즈 의미론 매트릭스** — 도메인 축 색(영업/딜리버리/재무/세무 N색) × 자율도/위험 램프(safe→supervised→blocked oklch L램프) × 아이콘/패턴 **이중인코딩** × WCAG 1.4.1 대비표. **연속 신뢰도→이산 색 경계값 명시**(P3 다이얼과 정합). 색렌즈=2시각축 이하 | "차별화 해자"인 색렌즈가 제약만 있고 비주얼 언어가 없으면 텍스트 약속에 그침 | tokens.css, 매트릭스 문서, playwright 스냅샷 | M | P0-6 | 디자인·AX |
| **P0-8** | **`@sangfor/ui` 13컴포넌트 채택 감사 + 3종 키트 결선** — 컴포넌트별 **채택/개작/폐기 판정+0-import 근본원인**(테마결합? API? 미완성?). EmptyState/LoadingState(Skeleton)/AsyncBoundary(ErrorState) 3종 web 결선+**`(portal)` 그룹에 `loading.tsx`/`error.tsx` 추가**(현재 0건). 각 키트 primary-action 슬롯 필수 | 이미 있는 걸 "신규"로 재축 중복 제거. P0-9가 이 키트에 의존 | packages/ui, (portal)/**, 신규 route segment | M | P0-6 | 디자인·UX |
| **P0-9** | **북극성 베이스라인 집계 + 계기판 스텁** — 승인소요시간·자동처리율·발행오류율·재방문을 `DomainDecisionLog`/손익뷰에서 *지금* 집계, Phase 0 베이스라인 스냅샷. 대시보드 `renewalsDue:0` 등 리터럴→실 Prisma 집계(`computePnl` 재사용), 미구현=명시 `null`. 빈상태=P0-8 액션형 EmptyState | 측정 없이 6주 결선=공급자 논리. 모든 Phase 완료기준에 지표 Δ | dashboard/[role]/route.ts, 신규 집계, role 페이지 | M | P0-3, P0-8 | 제품·아키 |
| **P0-10** | **IA 비파괴 정리 + One-Job primary-action 규약** — 고아 라우트 리다이렉트 통합+role별 메뉴 가시성 숨김. **각 1급 라우트=primary CTA 1개+빈상태는 그 CTA로 안내**(One-Job 규약, 누락 시 빌드 경고). `EntityDetailHeader`(제목·상태배지·primary-action 슬롯·More) 정의. **버튼만 꽂고 폼은 P1**(빈 클릭=역효과 방지) | "여기서 뭘 끝내나"를 선언. 라우트 중복 제거는 목적 부여 아님 | portal-config.ts, [id]/page.tsx, 신규 EntityDetailHeader | S~M | P0-6, P0-8 | UX·디자인 |
| **P0-11** | **라우터 생사 스파이크 + 워크트리/실DB 하니스** — tRPC 10라우터 호출 출처 매트릭스(web·services·MCP·api-internal, 생/사/self-call) — *코드 0줄*, grep+호출그래프. **기존 10개 .test.ts가 모킹인지 실DB인지 판정**(모든 e2e 게이트의 메타전제). `.worktrees/ax-overhaul` 머지/폐기. `migrate status` 1회 실측+18 history 무결성 | P0-9/P1-4가 REST를 정본으로 깔기 *전에* 두 번째 진실원천 판정 | apps/api/routers, packages/business 테스트, .worktrees | M | 없음(맨 앞) | 아키 |
| **P0-12** | **상태 라벨 단일소스 + 한글/원화(텍스트) + lang=ko** — `STATUS_LABELS`/`COLOR_AGENT_LABELS`를 전 배지에. raw enum 0건. $→원화·영문카피 한글화. `lang="ko"`. 폰트는 P0-6에서 이미 깔림(한글 Geist 깨짐 방지) | 비개발 직군 가독성. 최저비용 quick win | status-display.ts, 전 테이블, layout.tsx | S | P0-6 | UX·디자인·제품 |

### P1 — 차별화 deep + 골든패스 + 일상 표면

| ID | 무엇 | 가치 | 영향영역 | 난이도 | 의존 | 관점 |
|---|---|---|---|---|---|---|
| **P1-1** | **Engagement 축 정합화(신설 아님) + Cascade/soft-delete 결정** — `Engagement.projectId?`·`FinanceProject.engagementId?`·**self-FK**는 *이미 존재*. (a) backfill/dedup, (b) nullable→required 게이트, (c) `@unique`. **`onDelete:Cascade` to Project인 모든 자식 모델 열거 후 soft-delete 도입 시 Restrict/SetNull/미들웨어 모델별 결정**. 베이스라인 재생성 금지 | Opportunity id→Invoice 손익 FK 도달. 통합 축 구조 성립 | schema.prisma, 신규 migration, packages/business | M | P0-0, P0-11 | 아키·제품 |
| **P1-2** | **차별화 minimum-operational 버전(N건 배치·thin 아님)** — 보안메일 ***N건 배치* 복호화→표준XML→Evidence 인용체인(P0-5 동결)→예외 큐→"N건 중 M건 무인, K건 게이트" 정확도 지표→발행 전 게이트 diff→취소발행 발의(Undo 어휘 금지)**. 데모="1건 됨"이 아니라 "100건 중 96 무인, 4 게이트"(바이어 ROI 계산 가능) | B2B 바이어는 1건으로 안 산다 — 볼륨·정확도·예외처리가 deep 차별화 | hometax-securemail, domain-persistence.ts, CFO 발행, Evidence 카드, 예외큐 | L | P0-4, P0-5, P1-5 | 제품·AX·디자인 |
| **P1-3** | **AI 골든패스 + ⌘K 탐색(인덱스 선행) + 시드 자율도** — 가짜 Cmd+K 제거→`CommandDialog`. **전역 엔티티 검색 인덱스(customers/opportunities/projects 라벨+id) 선행 하위작업**(없으면 빈 ⌘K=G6 반복). 1차 탐색, 명령은 골든 1건("이 딜 제안서 초안")으로 좁힘→`runDomainStage`. **자율도 읽기전용 가시화**("이 액션 12/15 무인 후보")+룰 기반 시드 부트스트랩(콜드스타트: `sample<3`이어도 신호) | agentic 포지셔닝이 6주간 증발 방지. ⌘K 빈 결과만 반환=G6 재발 | portal-shell.tsx, ai-command-bar.tsx, 검색 인덱스, domain-agent-runtime.ts | M~L | P0-10 | 제품·UX·AX |
| **P1-4** | **도메인 파이프라인 1급 화면 + SSE + 실패 상태기계** — POST 경로(`runDomainPipeline`+persister, "demo-project" 제거 후)+recall→렌즈→게이트→핸드오프 라이브. stage별 status(pending/running/failed/gated/done), 부분실패 시 **발생한 부수효과+보상후보** 목록, SSE failed 이벤트, "재시도/건너뛰기/에스컬레이션". kill-switch(P0-4) 연동 | 최고 자산을 화면으로. 행복경로만=데모용 | domain-pipeline/page.tsx, route.ts, domain-agent-runtime.ts | M~L | P1-3, P0-11 | AX·제품 |
| **P1-5** | **위험 게이트 propose/execute 분리 + outbox(3단계 타입화)** — 가역=read-only 자율/write 게이트+diff. 지연가역=메일 `outbox` enqueue→N초 보류. **비가역=세금계산서: Undo 어휘 코드/카피 금지, "발행 전 최종 게이트(diff+승인자 실명+멱등키)"+"취소발행 발의(별도 승인)"**. 보류 표현=**단일 outbox 상태 영역**(토스트 스택 금지), 배치는 1개 집계 토스트. CFO=항상 supervised | 토스트로 메일/세금계산서 회수 불가 문제를 *처음부터* 타입으로 해소 | domain-agent-runtime.ts, domain-model-policy.ts, CFO 발행, 신규 outbox 영역 | M | P0-3, P0-4 | AX·제품·UX |
| **P1-6** | **엔티티 편집/생성 폼 결선(read-only 탈출) + 목록상태 보존** — **`EntityFormSheet` 공용 사이드시트**(필드스키마 주입+낙관적 업데이트+dirty-guard+인라인 검증)를 6엔티티(customers/partners/opportunities/poc/knowledge/projects)에 결선+PATCH/POST route. **폼+버튼 한 묶음**(P0-10 버튼만 먼저=빈클릭 역효과 금지). `useListState` 훅으로 필터·정렬·스크롤 URL 직렬화→상세 back 시 복원 | "read-only 앱"은 데모 즉시 들통. 60라우트 회유 마찰 1순위 완화 | 신규 entity-form-sheet.tsx, 6 detail page, PATCH/POST route, useListState | L | P0-10, P1-1 | UX |
| **P1-7** | **"내 업무" 통합뷰(받은편지함 병합) + 고밀도 테이블** — `/my-work`=내 배정/미완/승인대기 한 화면(받은편지함과 별개 화면 금지 — **두 탭으로 병합**). 기존 Prisma 집계, role별 랜딩. `approval`(스텁삭제)·`approvals`·도메인 레인을 공통 `PendingDecision` 큐로. **모으되 줄인다**(유사 묶기·배치·자동승인 임계). `DataTable`(compact/comfortable·tabular-nums 우정렬·CFO hairline 밀도 토큰) | 매일 머무는 표면+길 잃음/fatigue 해소. 총판 핵심=고밀도 테이블 | 신규 /my-work, approvals/page.tsx, packages/ui DataTable, 큐빌더 | L | P0-8, P0-10, P0-2 | UX·디자인·AX |

### P2 — 정직화 · 권한 · 디자인 완성 (쐐기 PMF 후)

| ID | 무엇 | 가치 | 영향영역 | 난이도 | 의존 | 관점 |
|---|---|---|---|---|---|---|
| **P2-1** | **인증/테넌트 단일화(MOCK_USER 제거)** *(쐐기 검증 후)* — 세션이 role/tenant/dataClassification 주입→nav·model 게이팅·RLS·감사. P0-4 데모 스위처를 실 세션으로 | 책임·격리의 실체화 | permissions.ts, 미들웨어, prisma RLS | L | P0-4, P0-0 | 제품·아키 |
| **P2-2** | **엔티티 삭제 UX + soft-delete + 단일 Undo 모델** — **삭제 영향 미리보기**("이 고객 삭제 시: 기회3·인보이스2·PoC1")+`deletedAt`(모든 read에 `deletedAt:null` 미들웨어 강제, P1-1 Cascade 결정 반영)+휴지통. **단일 Undo 정책**: soft-delete=토스트 Undo+휴지통(type-to-confirm 금지), type-to-confirm=하드딜리트만 | 파괴적 작업의 안전·되돌림 | 삭제 API dependency-count, delete-confirm.tsx, 미들웨어 | M | P1-1, P1-6 | UX |
| **P2-3** | **모션/로딩 토큰 + 두 테마 공존·전환 + 다크모드 분리** — duration/easing 토큰·스켈레톤·SSE 라이브 문법(신규행 페이드). **CFO↔포털 전환 시 시각점프 완충**(공유 chrome·전환 트랜지션). **다크모드는 semantic 토큰(P0-6) 완료 후 별도 L 작업으로 분리·포털 한정**(globals.css 다크참조 2건=사실상 신설, 첫 데모 ROI 최하—범위 재검토) | 라이브 문법+테마 전환 일관성 | globals.css, packages/ui, 전환 스펙 | M~L | P0-6, P0-7 | 디자인·UX |
| **P2-4** | **전송·접근 경계 단일화 + 권한 결선 + 사이드바** — P0-11 스파이크 결과로 죽은 라우터만 삭제. web 2계층(내부=프록시·외부=REST), 무가드 직접 Prisma에 인가 가드, CORS 정리. 38→role별 5~7개 `getVisibleNavItems`/`canAccessRoute`. 온보딩 체크리스트(메일연결→첫동기화→첫기회) | 경계 단일화·인가·네비 정돈 | apps/api/routers, web api/*, portal-config.ts, permissions.ts | L | P0-11, P2-1 | 아키·제품·UX |
| **P2-5** | **모노레포 정직화 + business 분할 + 경계 린트** — 죽은 패키지 판정(삭제 기본·결선은 1줄 근거). business **143파일**을 import-only로 `@sangfor/{domain-pipeline,finance,mail,engagement}` 분할. 16패키지 기준 경계 ESLint(scope·type 2축). `@sangfor/ui`는 P0-8 감사 결과 따름 | 빌드 경계·소유권 명확화 | packages/*, eslint, turbo | L | P0-11, P2-4 | 아키 |
| **P2-6** | **CFO 테마 토큰화 + 접근성** — cfo hex 8(theme)→`.theme-ledger` 토큰. crud-table div 모달→접근성 Dialog(focus-trap·Esc), alert/confirm lint 차단. 포커스 토큰. **목록 테이블 키보드 행이동·단축키 맵**(파워유저 경로). 두 테마 구별성 diff | 접근성·파워유저·테마 일관성 | cfo-theme.ts, crud-table.tsx, globals.css | M | P0-6, P2-3 | 디자인·UX |
| **P2-7** | **데이터 플라이휠 + 2차 커넥터 + 신뢰/규정 표면** — 승인이력·도메인 메모리가 *방어가능 자산으로 누적*되는 설계(복호화 복제돼도 데이터 우위 잔존)+2차 입구 최소 1개(카톡/엑셀/더존 import). 고객대면 신뢰 표면(데이터보안·전자세금계산서 법적책임·국세청 적합성 진술) | 해자의 실체화+세컨드 커넥터 | 메모리, 신규 커넥터, 문서 | L | P0-1, P1-2 | 제품·AX |

### P3 — 학습 거버넌스 (졸업 엔진)

| ID | 무엇 | 가치 | 영향영역 | 난이도 | 의존 | 관점 |
|---|---|---|---|---|---|---|
| **P3-1** | **학습형 자율도 졸업 엔진** — P1-3 가시화 위에 액션별 정확도·롤백률·시간감쇠로 전건→샘플→예외전용 **자동 졸업/강등**(항상 "제안"으로 사람 확인, `human-reverted` retract, CFO/발행 graduationLocked, kill-switch 연동). Evidence Pack=다이얼 drill-down(별도 카드 과잉 통합) | 자율도의 진짜 학습 거버넌스 | project-decision.ts, domain-agent-runtime.ts, 다이얼 UI | L | P0-1~5, P1-3, P1-5 | AX·제품·디자인 |
| **P3-2** | **세무 폐루프 풀 감사역추적 + replay + memory write-back 거버넌스** — P1-2를 전 결정이 보안메일/표준XML 라인까지 역추적하는 감사 데이터소스로 확장. **deterministic replay 하니스**("그 입력으로 다시 돌리면 같은 제안?"). "틀렸다"→이유 캡처→`memory confidence 0/source=human-reverted`→recall 제외 | 감사·재현·역학습 폐루프 | hometax-securemail, domain-persistence.ts, 메모리 | L | P1-2, P0-1, P0-5 | 제품·AX |

---

## 6) 단계적 실행 로드맵

> 각 Phase는 **독립 동작·검증 가능**. 완료기준은 측정 커맨드/픽스처로 표현.

### Phase 0 — 쐐기 + 토대 봉합 + 시각 시스템 + 측정 (1.5~2주)

- **목표**: 단일테넌트 붕괴·끊긴 학습 루프·측정 부재·비파괴 첫인상을 한 번에 봉합. 쐐기 선언으로 이후 모든 우선순위를 게이트.
- **산출물**: P0-W, P0-0, P0-1, P0-2, P0-3, P0-4, P0-5, P0-6, P0-7, P0-8, P0-9, P0-10, P0-11, P0-12.
- **검증**:
  - 쐐기 1페이지 존재(기각 기능 목록·경쟁 매트릭스 포함)
  - `grep demo-project`=0 · **서로 다른 두 project의 결정이 분리 집계**(붕괴 회귀 차단 픽스처)
  - **교정 케이스가 다음 동종 제안 recall top-K 등장**(현재 영구 0점)
  - 더블클릭 승인=단일 행 · 변경된 제안 승인 거부
  - kill-switch off 시 자동행위 0
  - 시각 토큰 2계층+Pretendard CLS 스냅샷 통과
  - 포털 loading/error 존재 · EmptyState web 결선
  - 북극성 4지표 베이스라인 스냅샷 기록
  - 고아 라우트 0 · 1급 라우트 primary CTA 존재
  - 라우터 생사표 작성 · 테스트 실DB/모킹 판정 완료
  - raw enum · "$" · `lang=en` 0건
- **독립성**: 토대·문서·시각·측정만 — 외부 의존 없이 단독 머지 가능.

### Phase 1 — 차별화 deep + 골든패스 + 일상 표면 (3주)

- **목표**: 쐐기를 minimum-operational로 deep하게 구현, 명령→엔진→화면 골든패스 완성, read-only 탈출.
- **산출물**: P1-1, P1-2, P1-3, P1-4, P1-5, P1-6, P1-7.
- **검증**:
  - **"100건 중 96 무인·4 게이트" ROI 데모**(바이어 계산 가능)
  - Opportunity→Invoice 손익 FK 도달
  - ⌘K 탐색이 실 결과 반환 · 자율도 읽기전용 신호 노출(콜드스타트도)
  - 발송 N초 보류 후 전송 · 단일 outbox 영역
  - **6엔티티 편집 폼 동작**(read-only 탈출) · 목록 상태 back 복원
  - 명령 1개 → 엔진 → SSE(실패 이벤트) → 아티팩트 → 승인 diff → DB → KPI 일관
  - 각 Phase 지표 Δ 기록
- **독립성**: Phase 0 토대 위. 각 P1 작업은 자체 검증 픽스처로 단독 머지 가능.

### Phase 2 — 권한·정직화·디자인 완성 (쐐기 PMF 후, 2~3주 일부 병렬)

- **목표**: 인증·삭제·경계·패키지·접근성·플라이휠을 실체화. *쐐기 PMF 신호 확인 후* 착수.
- **산출물**: P2-1, P2-2, P2-3, P2-4, P2-5, P2-6, P2-7.
- **검증**:
  - MOCK_USER 0 · RLS 동작
  - 삭제 영향 미리보기 · `deletedAt:null` 미들웨어 필터 강제
  - 죽은 라우터만 삭제(P0-11 표 근거)
  - cross-domain import 린트 통과
  - role별 nav ≤7
  - cfo hex 0 · 두 테마 전환 완충
  - 2차 커넥터 1개 동작
- **독립성**: 대부분 병렬 가능. P2-1(인증)이 P2-4(권한 결선) 선행.

### Phase 3 — 졸업 엔진 + 감사역추적 (3~4주)

- **목표**: 자율도를 진짜 학습 거버넌스로, 세무 폐루프를 감사·재현 가능하게.
- **산출물**: P3-1, P3-2.
- **검증**:
  - 액션별 자동 졸업/강등 · CFO graduationLocked · **표본 3건 윌슨 하한 미달이면 졸업 안 됨**
  - 세금계산서가 원본 보안메일 라인까지 역추적 · replay 일치
  - "틀렸다" → recall 제외
- **독립성**: P0~P1 신호 축적 위. 졸업 엔진은 P1-3 가시화와 분리되어 독립 검증.

---

## 7) "모든 코드 연결/완성" 통합 마일스톤

| ID | 마일스톤 | 완료기준 | 관련 작업 |
|---|---|---|---|
| **M0** | **단일테넌트 붕괴 차단** | `demo-project` 디폴트 제거→projectId 전파. **서로 다른 두 project의 결정이 각자 스코프로 분리 집계**(붕괴 회귀 차단 픽스처). 기존 `DomainDecisionLog` re-attribution 완료 | P0-0, P0-3 |
| **M1** | **학습 루프 봉합** | 교정 tags 주입→recall 어휘 정렬→음의 학습. **교정 케이스가 다음 동종 제안 recall top-K 등장**(현재 영구 0점) | P0-1 |
| **M2** | **AX 신뢰 무결성** | 페이로드+멱등+승인시점 evidenceHash 검증+provenance 동결+신원+kill-switch. 더블클릭=단일행, 변경된 제안 승인 거부, kill-switch off 시 자동행위 0 | P0-2/4/5 |
| **M3** | **명령→엔진→화면 골든패스** | ⌘K(검색인덱스)→의도분류→`runDomain*`→SSE(실패 이벤트)→아티팩트→승인 diff→outbox→DB→KPI 일관 | P1-3/4/5, P0-9 |
| **M4** | **영업→딜리버리→재무 체인** | nullable FK 정합화→backfill→NOT NULL 게이트→단일 join. Opportunity id→Invoice 손익 FK 도달 | P1-1 |
| **M5** | **비가역 3단계 안전망** | outbox N초 보류+세금계산서 발행전게이트/취소발행(Undo 어휘 금지)+soft-delete 단일 Undo | P1-5, P2-2 |
| **M6** | **단일 받은편지함+My Work 병합+fatigue 조절** | 모든 대기 `PendingDecision`+유사묶기/배치/자동승인 임계 | P1-7 |
| **M7** | **디자인 단일 출처** | 시각5종 토큰(컴포넌트보다 먼저)+색렌즈 매트릭스+13컴포넌트 감사+폰트/CFO/다크/접근성이 모두 단일 출처+시각 회귀 게이트 | P0-6/7/8, P2-3/6 |
| **M8** | **전송 경계+미사용 스키마 판정** | 라우터 생사→죽은 것만 삭제→2계층→인가 가드. ConnectorRegistry/AgentAssignmentRule/ExecutionPolicy를 실수요 스파이크 후 삭제 vs 결선(결선이 기본값 아님) | P0-11, P2-4/5 |
| **M9** | **측정 플라이휠** | 북극성 4지표 베이스라인→각 Phase Δ→데이터 플라이휠 누적 | P0-9, P2-7 |

---

## 8) 디자인 시스템 통일 방향

> **원칙: 시각 시스템이 컴포넌트보다 먼저(Phase 0).** 컴포넌트 선행 시 Phase 2에서 전량 retro-fit.

### 8.1 토큰 2계층 (P0-6)
- **Primitive**: `--color-{hue}-{step}`(oklch), `--space-{n}`(8px 그리드), `--font-size-{n}`(1.2 ratio 6단), `--radius-{n}`, `--shadow-{n}`.
- **Semantic**: `--bg/--surface/--border/--text/--accent/--danger/--warning/--success` 등 의도 기반. 컴포넌트는 semantic만 참조.
- globals.css 124변수를 이 2계층으로 재네이밍, 미분류 변수 0.

### 8.2 타이포 · 아이콘
- **Pretendard self-host**(woff2 서브셋, `--font-sans` 교체) — 한글 데모 정체성+CLS 방지. Geist 한글 깨짐 제거.
- **Lucide 아이콘 세트** 단일 채택. 색렌즈 이중인코딩(색+아이콘/패턴)의 아이콘 축.
- `lang="ko"`(P0-12).

### 8.3 색렌즈 시스템 (P0-7) — 차별화 비주얼 언어
- **도메인 축 색**: 영업/딜리버리/재무/세무 N색(2 시각축 이하로 제한).
- **자율도/위험 램프**: safe→supervised→blocked를 oklch L(명도) 램프로.
- **이중인코딩**: 색 단독 금지 — 아이콘/패턴 병행(WCAG 1.4.1 대비표 동반).
- **연속 신뢰도→이산 색 경계값** 명시(P3 자율도 다이얼과 정합).

### 8.4 밀도 · 반응형
- compact/comfortable 밀도 토큰, breakpoint 3단.
- 총판 핵심 = **고밀도 DataTable**(tabular-nums 우정렬, CFO hairline 밀도).

### 8.5 상태 키트 (P0-8) — 신규 아님, 채택+결선
- `@sangfor/ui` 13컴포넌트 채택/개작/폐기 감사+0-import 근본원인 규명.
- EmptyState/LoadingState(Skeleton)/AsyncBoundary(ErrorState) 3종 web 결선, `(portal)`에 `loading.tsx`/`error.tsx` 추가. 각 키트 primary-action 슬롯 필수.

### 8.6 두 테마 공존 (P2-3/6)
- CFO `.theme-ledger` 토큰화(hex 8 제거), CFO↔포털 전환 시각점프 완충.
- **다크모드는 semantic 토큰 완료 후 별도 작업으로 분리·포털 한정**(현재 다크참조 2건=사실상 신설, 첫 데모 ROI 최하).

### 8.7 접근성 (P2-6)
- crud-table div 모달→접근성 Dialog(focus-trap·Esc), alert/confirm lint 차단, 키보드 행이동·단축키 맵.

### 8.8 회귀 게이트
- 모든 시각 변경에 playwright 메트릭/스냅샷 회귀 게이트.

---

## 9) 리스크 · 롤백 전략

| 리스크 | 영향 | 완화 / 롤백 |
|---|---|---|
| **`demo-project` 제거 시 미전파 호출자 폭발** | 런타임 throw 다발 | 디폴트 삭제를 컴파일/런타임 에러로 강제 노출(은닉 오염보다 나음), 호출자 인벤토리 선작성. `grep demo-project`=0 CI 게이트. 롤백: dual-read N주 |
| **학습 봉합해도 vocabulary 불일치 잔존** | recall 여전히 미스 | 저장·질의 태그 단일 사전 고정+"교정→recall 등장" e2e 게이트. 어휘 헌법 문서화 |
| **기존 결정 로그 re-attribution 데이터 손실** | 자율도 오염 | dry-run+백업, 컬럼 추가와 귀속을 동일 마이그레이션. 롤백: 레거시 projectId 보존 |
| **자동 졸업이 오승인/표본편향 학습** | 자동화 신뢰 붕괴 | 윌슨 하한+졸업은 항상 제안+CFO graduationLocked+kill-switch+human-reverted retract. 졸업기능과 보수성 동시 출시 |
| **비가역(세금계산서)에 Undo 어휘 오용** | 데모 거짓말 | 코드/카피에서 발행 Undo 금지, 발행전게이트+취소발행 발의로 명명 분리, 3단계 타입화 |
| **outbox 보류가 새 fatigue** | UX 악화 | 토스트 스택 금지, 단일 outbox 영역+배치 집계 토스트 1개 |
| **버튼만 먼저 꽂아 빈클릭** | 신뢰 역효과 | P0-10은 버튼+규약만, 폼+버튼은 P1-6 한 묶음 |
| **시각 토큰 없이 컴포넌트 선행→retro-fit** | 6주 누적 하드코딩 | 시각5종·폰트·색렌즈를 Phase 0 첫 작업, 13컴포넌트 감사로 재사용 우선 |
| **다크모드가 "한정"이 아닌 신설(2 refs)** | 비용 L 과소평가 | semantic 토큰 완료 후 분리·포털 한정, 첫 데모 범위 외 검토 |
| **soft-delete × Cascade 충돌** | 자식 hard-cascade 소실 | P1-1에서 Cascade→Restrict/SetNull 모델별 선결정+`deletedAt:null` 미들웨어 |
| **tRPC 삭제가 self-call/MCP 누락** | 런타임 깨짐 | P0-11 생사 스파이크 선행(Phase 0). 삭제 가능분만. 롤백: git revert 독립 PR |
| **콜드스타트로 자율도 영영 학습중** | agentic 증발 | 룰 시드 부트스트랩(`sample<3`도 신호)+읽기전용 가시화 P1 |
| **쐐기 미선언→풀스택 과잉설계** | 출시=또 하나의 CRM | P0-W가 모든 우선순위 상위 게이트, P2는 쐐기 PMF 후 |
| **북극성 미측정→ROI 서사뿐** | 공급자 논리 | 베이스라인 Phase 0+각 Phase Δ 완료기준 |
| **prod `next build` 선결함**(useMemo null on /, /development/improvements) | CI 차단 | 독립 추적 이슈, dev 검증+해당 페이지 수정 후 prod 게이트 |

---

## 10) 첫 번째 실행 Phase(Phase 0) 상세 — 바로 착수 가능

> 실행팀이 그대로 따를 순서. **P0-W → P0-0/P0-11(병렬) → P0-1/2/3 → P0-4/5 → P0-6/7/8 → P0-9/10/12**. 의존 없는 것은 병렬.

### 착수 순서 (의존성 위상 정렬)

**Step 1 — 게이트 (병렬, 코드 0줄)**
- **P0-W(쐐기 문서)**: 1페이지 작성. "카테고리/차별점/기각 기능/경쟁 매트릭스/데모 헤드라인". 이게 없으면 나머지 착수 금지.
- **P0-11(라우터 생사 스파이크)**: `grep`+호출그래프로 tRPC 10라우터 생/사/self-call 매트릭스. 기존 10 .test.ts 모킹/실DB 판정. `.worktrees/ax-overhaul` 처리. `migrate status` 실측+18 history.

**Step 2 — 토대 봉합 (P0-W 통과 후)**
- **P0-0(`demo-project` 제거)**: `resolveDomainProjectId` 디폴트 삭제→throw. projectId 전파(engagement→opportunity→project). ERD+join 매트릭스. re-attribution dry-run(P0-3 마이그레이션과 동일 트랜잭션).
  - 파일: `packages/business/src/domain-memory.ts`(L83), `packages/business/src/project-decision.ts`(L22~), `packages/db/prisma/schema.prisma`, 신규 migration.

**Step 3 — 학습 + 무결성 (P0-0 후)**
- **P0-1(학습 봉합)**: `upsertDomainMemory`에 `tags=[domain,entityType,intentTag]` 주입; 질의·저장 태그 단일 vocabulary 정렬; `source="human"` 가중 상향; rejected→negative exemplar(현재 +0.3 양수 제거).
  - 파일: `project-decision.ts`(L40~50), `domain-memory.ts`(L42,52,56), `domain-proposal.ts`(L96).
- **P0-2(승인 무결성)**: `LaneDecisionControls` 페이로드 확장(`proposalId`+`output`+`humanEdit{field,before,after}`); route 유니크 `(domain,caseRef,decisionType)`+제안별 1회(중복=409); evidenceHash 승인시점 검증.
  - 파일: `apps/web/src/components/hub/lane-decision-controls.tsx`(L57), `apps/web/src/app/api/projects/[id]/domain-decision/route.ts`.
- **P0-3(텔레메트리+보수화)**: `DomainDecisionLog`에 `actionType/revertedAt/revertReason/modelVersion/decidedByUserId` 추가(P0-0 마이그레이션과 동일). `computeAutonomy`→윌슨 하한+시간감쇠+actionType 차원. CFO/발행 `graduationLocked`.
  - 파일: `schema.prisma`, `project-decision.ts`(L66,75).

**Step 4 — 안전 토대 (병렬)**
- **P0-4(신원+kill-switch)**: RoleContext userId 주입+dev Role Switcher(플래그). `AutonomyKillSwitch`(테넌트별)—자동 실행 경로 진입 체크.
  - 파일: `permissions.ts`, `portal-shell.tsx`, `domain-agent-runtime.ts`.
- **P0-5(provenance 동결)**: `domain-proposal.ts` 생성 시 `proposalSnapshot`(메일 line id, recall hit ids+confidence, 정책버전, 손익 입력) immutable 동결. 카드는 동결본만.
  - 파일: `domain-proposal.ts`, `schema.prisma`.

**Step 5 — 시각 시스템 (컴포넌트보다 먼저, 병렬 가능)**
- **P0-6(시각5종)**: globals.css 124변수→2계층 토큰+8px 간격+타입스케일 6단+Pretendard self-host+Lucide+밀도/반응형 토큰. 메트릭 회귀 스냅샷.
  - 파일: `globals.css`, 신규 `tokens.css`, `layout.tsx`, playwright.
- **P0-7(색렌즈 매트릭스)**: 도메인색 × 위험램프 × 이중인코딩 × WCAG 대비표 + 신뢰도→이산 색 경계값. (P0-6 후)
- **P0-8(13컴포넌트 감사+3종 결선)**: 채택/개작/폐기 판정+0-import 근본원인. EmptyState/LoadingState/AsyncBoundary web 결선+`(portal)` loading.tsx/error.tsx. (P0-6 후)
  - 파일: `packages/ui/src/`, `apps/web/src/app/(portal)/**`.

**Step 6 — 측정 + IA + 라벨 (시각 후)**
- **P0-9(북극성 베이스라인)**: 4지표 집계+베이스라인 스냅샷. `renewalsDue:0` 등 리터럴→실 Prisma 집계(`computePnl` 재사용), 미구현=`null`. 빈상태=P0-8 EmptyState.
  - 파일: `apps/web/src/app/api/dashboard/[role]/route.ts`(L20).
- **P0-10(IA+One-Job)**: 고아 라우트 리다이렉트+role 가시성. 1급 라우트=primary CTA 1개+빈상태 안내. `EntityDetailHeader` 정의. **버튼만, 폼은 P1-6**.
  - 파일: `portal-config.ts`, `[id]/page.tsx`, 신규 `EntityDetailHeader`.
- **P0-12(라벨+한글+lang=ko)**: `STATUS_LABELS`/`COLOR_AGENT_LABELS` 전 배지, raw enum 0, $→원화, 카피 한글화, `lang="ko"`.
  - 파일: `status-display.ts`, 전 테이블, `layout.tsx`.

### Phase 0 완료 정의(DoD) — CI 게이트화
1. `grep -rn demo-project packages/business/src` = **0** (CI 게이트).
2. 픽스처: 서로 다른 두 projectId 결정이 **분리 집계**.
3. 픽스처: 교정한 케이스가 다음 동종 제안 **recall top-K에 등장**.
4. 픽스처: 동일 제안 더블클릭 승인 = **단일 행**(중복 409).
5. 픽스처: `evidenceHash` 불일치 시 승인 **거부**.
6. kill-switch off 시 자동 실행 경로 **0건** 통과.
7. `lang="ko"`, raw enum 0, "$" 0.
8. 포털 `loading.tsx`/`error.tsx` 존재, EmptyState web import ≥1.
9. Pretendard 적용+CLS 스냅샷 통과, 토큰 미분류 변수 0.
10. 북극성 4지표 베이스라인 스냅샷 파일 커밋.
11. 라우터 생사 매트릭스 문서 + 테스트 실DB/모킹 판정 문서 커밋.
12. 고아 라우트 0, 모든 1급 라우트 primary CTA 존재.

### 핵심 파일 인덱스 (절대경로)
- `/Users/jmpark/Playground/sangfor-os/packages/business/src/domain-memory.ts` — L83 `resolveDomainProjectId(slug="demo-project")` 단일테넌트 · L52,56 tags 0이면 score 0 · L42 rejected +0.3 · L105 tags 기본값 `[]`
- `/Users/jmpark/Playground/sangfor-os/packages/business/src/project-decision.ts` — L40~50 `upsertDomainMemory` tags 미주입(학습 끊김) · L22~ projectSlug 미전파 · L66,75 computeAutonomy 단순비율 min3
- `/Users/jmpark/Playground/sangfor-os/packages/business/src/domain-proposal.ts` — L96 recall 질의 tags 노이즈 · L152 projectId 해석 패턴(재사용) · provenance 동결 대상
- `/Users/jmpark/Playground/sangfor-os/apps/web/src/components/hub/lane-decision-controls.tsx` — L57 humanEdit `{note}`만
- `/Users/jmpark/Playground/sangfor-os/apps/web/src/app/api/projects/[id]/domain-decision/route.ts` — 인증·멱등 0
- `/Users/jmpark/Playground/sangfor-os/apps/web/src/app/api/dashboard/[role]/route.ts` — L20 `renewalsDue:0` 리터럴
- `/Users/jmpark/Playground/sangfor-os/packages/db/prisma/schema.prisma` — Engagement.projectId? · FinanceProject self-FK · DomainDecisionLog projectId NOT NULL+Cascade
- `/Users/jmpark/Playground/sangfor-os/packages/ui/src/` — 13컴포넌트(EmptyState/ErrorState/Toast/Skeleton 등) 이미 존재 · web import 0
- `/Users/jmpark/Playground/sangfor-os/apps/web/src/app/globals.css` — 124변수 미분류 · 다크참조 2
- `/Users/jmpark/Playground/sangfor-os/apps/web/src/lib/cfo-theme.ts` — hex 8
- `/Users/jmpark/Playground/sangfor-os/apps/api/src/routers/` — 10라우터 생사 미판정
- `/Users/jmpark/Playground/sangfor-os/apps/web/src/app/cfo/(cfo)/loading.tsx`·`error.tsx` — 포털엔 부재

### 정량 기준선 (HEAD `ffad361`)
migration **18** · package **16** · cfo-hex **8** · ui 컴포넌트 **13**(web import **0**) · demo-project grep **20곳** · nav **38** · 라우트 **60** · globals.css 변수 **124**(다크참조 2) · tRPC 라우터 **10** · business 파일 **143**.