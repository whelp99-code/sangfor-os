# 베를로 OS 6개월 로드맵 (2026-07 ~ 2026-12) — 문서 08

> **작성일**: 2026-07-08 (v1 완성 웨이브 + 분류기 캘리브레이션 직후) · **기준**: main @ PR #105 머지
> **대상 독자**: 이 저장소를 처음 여는 구현 에이전트와 운영자(사용자). 이 문서 하나로 "다음 6개월간 무엇을, 왜, 어떤 순서로, 어떤 기준으로" 판단할 수 있어야 한다.
> **정본 관계**: 03~07 문서(고도화 상세)가 **작업 내용의 정본**이고, 이 문서는 그것들을 **시간 축(월별)** 위에 배치하고 상시 운영 트랙·KPI·리스크를 더한 실행 캘린더다. 충돌 시 00-INDEX §5 우선순위를 따르되, "언제 하는가"는 이 문서가 결정한다.
> **유지 규칙**: 매월 말 회고 절(§10)에 실적 1줄 + 다음 달 조정 사항을 기록한다. 큰 방향 변경은 ADR로.

---

## 1. 현재 상태 스냅샷 (2026-07-08 00시)

구현 에이전트는 아래를 사실로 받아들이고 재검증에 시간을 쓰지 않는다 (착수 시 `git log --oneline -5`로 이후 변화만 확인).

### 1.1 제품 — v1 완성 상태
- **마스터플랜 01 (WP-A~E) 전부 머지**: 도메인 AI 제안→5렌즈 검증→사람 승인→문서 승격 루프 라이브 재연 확인, 전 화면 지표 단일화(진행중 딜 = 5표면 동일 값), 데이터 3섬(CRM/메일/재무) 1차 연결, "준비 중"/가짜 계기 0, IA 단일화(/deals·/inbox).
- **CI**: lint/typecheck/test/build/secrets + **e2e(playwright webServer 자체부팅)가 차단 체크**. 로컬 검증은 `PORT`/`API_PORT` 오버라이드로 포트 충돌 없이 실행 가능.
- **2026-07-07~08 머지 PR**: #96 컬러게이트 루프+dev-up 픽스 · #97 지표 정합 · #98 화면 정직성(AI커맨드바 SSE 배선) · #99 e2e 차단화 · #100 데이터 섬 브리지(기본 프로젝트 리졸버) · #101 IA 정리 · #102 문서 동기화 · #103 토스트 클리핑 · #104 증거 보충 · #105 **분류기 캘리브레이션**.

### 1.2 데이터 (실DB, postgres :5434 sangfor_os)
| 항목 | 값 | 비고 |
|---|---|---|
| customers / partners | 152 / **3** | partners 3행은 ground-truth(파트너 49)와 큰 격차 — M2 과제 |
| engagements (delivery_projects) | 12 | 전부 고객·프로젝트 연결(backfill 완료) |
| 재무 연결 (cashflow/invoice/expense→engagement) | 19 / 229 | FP 브리지 7/17 매핑, **미매핑 FP 10건은 human 매핑 대기**(M1) |
| 메일 후보 | proposed **964** · rejected 176 · converted 171 · knowledge 42 | 캘리브레이션 재검증으로 218건 자동 정리(1,155→964) |
| 캘리브레이션 산출 | 이중게이트(≥85 AND approve_candidate) **12건 승인 대기** · LLM 폴백 **529건 재패스 필요**(자가치유 캐시 — 재실행 시 자동 재시도) | §9 인수인계 |

### 1.3 런타임
- **실사용(프로드)**: `~/orca/workspaces/sangfor-os/main-fork` = **main 직접 추적** (:3100 web / :3210 api). 관리: `bash scripts/prod-local.sh {start|stop|restart|status}` — **pull 후 반드시 `restart --build`** (start는 재빌드 안 함).
- **개발**: `~/Playground/sangfor-os` = dev-clean 브랜치. dev 스택 `scripts/dev-up.sh` (:3101/:3200).
- **LLM**: 로컬 9router(:20128, OpenAI 호환, 제로비용) — 모델 `cx/gpt-5.4-mini`. **opencode.ai zen은 월간 한도 소진(429), ~7/23 리셋** — main-fork `.env`에 OPENAI_* 가 zen/9router 이중 정의돼 있어 정리 필요(M1-W1, dotenv는 선행 정의 승리라 프로드가 zen을 볼 위험).
- 백업: DB cron 21:00(`scripts/db-backup-local.sh`), 캘리브레이션 전 백업 `/tmp/calib-backup-2326.sql` + `.agents/backups/2026-07-07/`.

### 1.4 원격/브랜치
- 원격 브랜치는 **main 하나** (머지 시 자동삭제 + 2026-07-07 대청소). 워크트리는 루트(dev-clean)와 main-fork(main) 둘만 유지.

---

## 2. North Star & 6개월 KPI

**North Star**: *"메일이 들어오면, 사람은 결정만 한다."*
인입(메일) → 분류(신뢰도) → 제안(도메인 AI) → 검증(컬러게이트) → 결정(사람, 점차 자동) → 학습(DomainMemory/정책) → 실행(엔티티/문서/재무 반영)의 플라이휠이 **실업무 데이터로 매일** 도는 상태. 12월에는 저위험 결정의 상당수가 자동 승인되고, 사람의 개입은 고위험·모호 케이스로 수렴한다.

| KPI | 측정 방법 | 7월(기준) | 9월 목표 | 12월 목표 |
|---|---|---|---|---|
| 메일 후보 큐 리드타임(인입→결정) | mail_derived_candidates created_at→resolved 시각 | 측정 시작 | < 3일 | < 1일 |
| 후보 정밀도(승인율 = 승인/(승인+거부)) | 주간 SQL 리포트 | 측정 시작 | ≥ 70% | ≥ 85% |
| 자동 승인 비율(전체 결정 중 actor='ai') | domain_decision_logs | 0% | 파일럿(저위험 1종) | ≥ 30% (저위험 한정) |
| 자동 결정 뒤집힘율(사람이 24h 내 회수) | 05 문서 KPI | — | < 5% | < 5% |
| 재무↔engagement 연결률 | 19/229 (8.3%) | 8.3% | ≥ 60% (human 매핑 후) | ≥ 80% |
| e2e/CI green 유지 | GitHub Actions | 차단화 완료 | 유지 | 유지 |
| 자율도 표본(사람-신호 행) 축적 | computeAutonomy 입력 | 소량 | 도메인당 ≥ 10 | 도메인당 ≥ 30 |

> KPI 측정용 주간 SQL 묶음은 M1-W1에 `scripts/kpi-weekly.sql`(신규)로 고정하고, 매주 결과를 `.agents/results/kpi/`에 쌓는다.

---

## 2.5 월별 상세화 프로토콜 (집행 에이전트 필독 — 이 규약 없이 M2~M6 구현 착수 금지)

이 로드맵의 M2~M6 절은 **마일스톤 수준**이다. 지금 전부 스텝 단위로 쪼개지 않는 이유는 실증된 문서 노화 때문 — 2026-07-04 계획서의 "demo-project 18곳"이 3일 뒤 실측 **93곳**이었다(01 문서 C-2 기록). 상세화는 **집행 직전에, 실측 기반으로** 한다.

**매월 착수 세션의 의무 절차**:
1. **읽기**: 이 문서의 해당 월 절 → 그 월의 정본 문서(03~07) → `backlog.md` → `DEV_REFERENCE.md` §8 → **실측**(계획 속 수치를 믿지 말고 grep/SQL로 재확인).
2. **생성**: `docs/master-plan/monthly/<YYYY-MM>-detail.md`를 **01 문서 표준**으로 작성 — Task마다 **Files**(정확한 경로)/**Interfaces**(시그니처)/**Steps**(체크박스+명령어)/**Acceptance**(검증 가능 기준). 실측이 로드맵과 다르면 로드맵을 고치고 변경 이력에 1줄.
3. **승인**: 사용자에게 그 달 요약+순서 근거 제시 → 승인 후 omo-start-work로 집행 (검증 게이트는 02 준용).
4. **마감**: 월말 §10 회고에 실적 1줄 + 다음 달 조정.

M1은 아래 §3에 **이미 이 표준으로 분해돼 있다** — 첫 달은 바로 집행 가능.

---

## 3. M1 — 2026년 7월: 운영 정착 + 1차 고도화(03) 착수

**비즈니스 가치**: 오늘 만든 v1이 "실제로 매일 쓰이는 도구"가 된다. 승인 큐가 돌기 시작하고, 재무 손익이 프로젝트별로 보인다.

> W1 태스크는 01 문서 표준으로 분해됨. 공통 규칙: 코드 작업은 워크트리(셋업 순서 §9 하단), 커밋은 Conventional Commits, PR은 auto-merge(e2e 차단 체크 포함), DB 운영은 백업 선행.

### Task M1-1: 캘리브레이션 운영 마감
**Steps**: §9의 1~3을 그대로 실행 (명령어 수준으로 이미 기술됨).
**Acceptance**: 이중게이트 12건 승인·전환 완료 + `.agents/results/2026-07-08-calib-ops.md`에 전후 분포 + boulder `classifier-calibration-2026-07-07` completed.

### Task M1-2: main-fork `.env` OPENAI 이중 정의 정리
**Files**: `/Users/jmpark/orca/workspaces/sangfor-os/main-fork/.env` (untracked — 시크릿, 커밋 금지)
- [ ] Step 1: `cp .env .env.bak-$(date +%m%d)` (백업 필수)
- [ ] Step 2: 파일 앞쪽의 zen 블록(`OPENAI_API_KEY`/`OPENAI_BASE_URL="https://opencode.ai/zen/..."`/`OPENAI_MODEL="qwen3.7-plus"` 3줄)을 `#`로 주석화 — 뒤쪽 9router 블록(`http://127.0.0.1:20128/v1`, `cx/gpt-5.4-mini`)만 활성. **이유**: Next.js dotenv는 선행 정의가 이기므로 현재 프로드가 한도 소진된 zen을 볼 위험.
- [ ] Step 3: `grep -c "^OPENAI_API_KEY" .env` → **1** 확인
- [ ] Step 4: `bash scripts/prod-local.sh restart --build` (start만으로는 재빌드 안 됨)
- [ ] Step 5: 라이브 확인 — /sales 커맨드바에서 명령 1회: "실행 실패"가 아닌 실답변이 오면 PASS (또는 9router 콘솔에서 호출 로그 확인)
**Acceptance**: 프로드 LLM 호출이 9router로 감(zen 429 미발생), `.env` 백업 존재.

### Task M1-3: FinanceProject 미매핑 10건 human 매핑
**Files**: `packages/db/scripts/backfill-finance-engagement.ts`(확장) · 신규 `packages/db/scripts/fp-engagement-map.json`
**Interfaces**: 스크립트에 `--mapping-file <path>` 모드 추가 — `{ "<fp.name>": "<engagementId>" | null }` (null = "매핑 없음" 확정)
- [ ] Step 1: UNMATCHED 10건(게임조선/대통령경호처/동국대/디지털조선/부산도시가스/에스씨엘/유니드/인카금융그룹/일지테크/2월 카드사용료)을 engagement 후보 목록과 함께 **사용자에게 표로 제시** — 상당수는 대응 engagement가 아예 없을 수 있음(null 확정이 정답)
- [ ] Step 2: 사용자 확정값으로 json 작성
- [ ] Step 3: 스크립트 확장(opencode 위임 가능) — 매핑 파일 검증(존재하는 fp.name/engagementId인지) + dry-run 기본 + APPLY=1
- [ ] Step 4: `pnpm --filter @sangfor/db cfo:snapshot` → dry-run 검토 → APPLY
- [ ] Step 5: 연결률 SQL 전후 기록 (기준: 19/229 = 8.3%)
**Acceptance**: 매핑 가능한 FP 전부 연결 + 나머지는 null 확정(모호 0), 연결률 ≥60% 또는 "실데이터상 상한" 명시.

### Task M1-4: 상류 아티팩트 필터 (생성 단계)
**Files**: `packages/business/src/mail/candidates-generate.ts` · `classify-rules.ts`(공유 상수) · 각 테스트
**Interfaces**: `export function isArtifactEntityName(name: string): boolean` — 재검증 프롬프트(classify-ai.ts의 DOMAIN KNOWLEDGE 아티팩트 목록)와 **단일 소스** 공유
- [ ] Step 1 (TDD): 실패 테스트 — "Example"/"Mail"/"Mails"/"<1 min"/2자 미만/숫자·기호만/"Re:"·"Fw:" 접두 → true; 정상 회사명(한/영) → false
- [ ] Step 2: 구현 + 재검증 프롬프트의 하드코딩 목록을 이 상수로 치환(프롬프트-코드 동기화)
- [ ] Step 3: candidates-generate의 customer/partner 후보 생성 직전에 필터 — 아티팩트면 후보 생성 스킵(로그만)
- [ ] Step 4: 검증 — 최근 mail_insight_threads 30건으로 생성 함수 드라이런(테스트 또는 tsx) → 아티팩트 이름 후보 0
**Acceptance**: 신규 생성 후보에 아티팩트 0, 기존 테스트(582) 무회귀, 프롬프트와 코드가 같은 목록 사용.

### Task M1-5: 재검증 데일리 배치 상시화
**Files**: 신규 `packages/business/scripts/revalidate-batch.ts` (wp-calib 워크트리의 `calib-run.local.ts`를 일반화해 **정식 커밋**) · launchd plist 또는 crontab 항목
**Interfaces**: `--status proposed --concurrency 2 --max <N>` 인자, 출력 = 처리/폴백/reject 카운트 + jsonl 로그
- [ ] Step 1: 러너 일반화(id 파일 대신 DB 쿼리로 대상 선정, 폴백은 자가치유 캐시가 자동 재시도 — force 불필요)
- [ ] Step 2: 로그를 `.agents/results/kpi/revalidate-YYYYMMDD.log`에 적재, 폴백률 >30%면 경고 라인
- [ ] Step 3: 스케줄 등록(사용자 승인 후 — launchd 권장, 22:30 등 9router 한가한 시간)
- [ ] Step 4: 3일 관찰 — 폴백 잔량(현재 529) 감소 추세 확인
**Acceptance**: 3일 연속 자동 실행 성공 + 신규 proposed가 24h 내 재검증됨.

### Task M1-6: KPI 주간 측정 고정
**Files**: 신규 `scripts/kpi-weekly.sql` + `scripts/kpi-weekly.sh`(psql 실행 → `.agents/results/kpi/kpi-YYYYMMDD.txt`)
- [ ] Step 1: §2 표의 각 지표를 SQL로 — 큐 분포/리드타임(주의: resolved 시각 컬럼이 없으면 updated_at 근사, 한계 주석)/승인율/연결률/자동승인 비율(domain_decision_logs의 actor)
- [ ] Step 2: 첫 실행 → **기준선(baseline) 기록**
- [ ] Step 3: 주간 실행을 M1-5의 스케줄에 동승
**Acceptance**: kpi/ 디렉터리에 첫 리포트 + 각 지표의 기준선 수치 확정.

### W2~W4: 1차 고도화 (03 문서 + `docs/superpowers/plans/2026-07-03-phase-*.md`가 줄 단위 정본)
- [ ] **Task 0 — ADR-002** (선행 필수, M4가 이 결정에 의존): 산출물 `docs/adr/ADR-002-api-surface.md`. 결정 인풋: ①00-INDEX §5의 상충 2건(마스터플랜 "웹=BFF, tRPC 제거" vs phase-6 문서 "tRPC 도입"; Phase 7 인덱스/FK vs 신규 컬럼) ②현 코드 관성(REST 라우트 ~95개, tRPC 일부 잔존) ③06 재구조화와의 정합. 결정 기준을 명시하고 한쪽을 채택 — 반나절 작업.
- [ ] **리팩토링 Phase 2 잔여**(Task 2·3·4 dedup) → **Phase 3** web route 레이어링(11 라우트) → **Phase 4** `mail-candidates.ts` God-file 분해(캘리브레이션으로 이 영역 지도가 가장 선명한 지금이 적기). 각각 03 문서의 태스크 정의를 따르되, **착수 시 실측 재확인**(2.5 프로토콜).
- 게이트: 02 검증서 + 특성화 테스트 유지 + e2e green.

**M1 종료 기준**: KPI 기준선 확정, 큐 리드타임 첫 측정치, 재무 연결률 ≥60%(또는 상한 명시), 03 문서 체크박스 ≥80%, 데일리 배치 3일 연속 가동.

---

## 4. M2 — 2026년 8월: 2차 고도화(04) + 데이터 위생

**비즈니스 가치**: 모든 의사결정이 한 곳(결정 스파인)에 쌓여 감사 가능해지고, 파트너/고객 원장이 현실과 일치한다.

- [ ] **결정 스파인 완전 수렴** (04 문서 = 정본): convergence PLAN §7 이월 레지스터 소화, `recordDecision()` 단일 write path 완결, 우회 기록 경로 제거.
- [ ] **AI 역할 재편**: ai-roles 설계 반영 — 컬러 렌즈(검증)와 도메인 에이전트(생성)의 역할 경계 정리, 커맨드바 에이전트(`/api/agent/run`)에 실무 플레이북 연결(현재 안전 도구만).
- [ ] **파트너 데이터 재구축**: partners 3행 ↔ ground-truth 파트너 49의 격차 해소. 2026-06-30 분류 결과의 구조화 소스가 유실됐으므로(캘리브레이션 정찰 확인) — 커밋 이력/문서에서 복원하거나, 재검증 파이프라인으로 파트너 후보를 승인 큐에서 일괄 처리해 재구축.
- [ ] **고객 domain 백필** (WP-C C-4 Step4 스킵분): 위 ground-truth 구조화가 선행되면 실행. Customer.domain 채움 → 분류 정밀도 상승 피드백.
- [ ] **converted 후보 위생**: 과거 bulk convert가 createdEntityId 미설정이던 시절 데이터 백필(backlog 항목).

**M2 종료 기준**: 결정 로그 우회 경로 0, partners ≥ 40행(실데이터), 후보 정밀도 KPI 개선 확인.

---

## 5. M3 — 2026년 9월: 3차 고도화(05) — 자율운영 파일럿

**비즈니스 가치**: "AI가 초안, 사람이 결정"에서 **"저위험은 AI가 결정, 사람은 감사"**로 첫 전환. North Star의 핵심 관문.

선행조건 충족 확인: 캘리브레이션(신뢰도 유의미) ✅(M1) · 이중게이트 ✅ · 결정 스파인 ✅(M2) · 자율도 표본 축적(M1~M2 운영에서).

- [ ] **AutonomyPolicy 모델 + resolveAutonomyMode** (05 문서 = 정본): `mode=auto AND autonomy.score≥0.9 AND samples≥10 AND colorGatePass` 조건, 미달 시 suggest 강등.
- [ ] **runAutopilotPass**: 1순위 대상 = mail_candidate 중 **이중게이트 통과분**(현 기준 그대로 — confidence≥85 AND decision=approve_candidate). `actor='ai'` 승인 기록.
- [ ] **안전장치 전부**: 돈 걸린 결정 자동화 금지, 24h 회수, `AUTOPILOT_ENABLED=0` kill-switch, 와치독(일일 이상 감지 리포트).
- [ ] **상시 파이프라인**: 메일 sync → 분류 → 재검증 → 큐 → (autopilot) 의 cron 체계화. 실패 시 정직한 알림(운영자 데일리 리포트에 파이프라인 헬스 포함).
- [ ] LLM confidence 의미론 정리(backlog): "결정 확신도 vs 후보 품질" 혼재를 autonomy 점수 도입과 함께 정의 통일.

**M3 종료 기준**: 저위험 1종(메일 후보 승인) 자동화 가동, 뒤집힘율 < 5%, kill-switch 실훈련 1회.

---

## 6. M4 — 2026년 10월: 4차 고도화(06) — 플랫폼 통합

**비즈니스 가치**: 성장 속도를 떨어뜨리던 구조 부채를 청산해, 이후 기능 추가 비용을 절반으로.

- [ ] **business 패키지 재구조화**(9폴더, 06 문서 = 정본): mail/crm/finance/domain-ai 등 경계 확정. **demo-project B그룹 86곳**을 재구조화와 함께 일괄 리졸버 주입(같은 파일들을 어차피 만지므로 이때가 최저비용).
- [ ] **API 표면 통일**: ADR-002(M1 결정) 실행.
- [ ] **DB 인덱스·FK 승격**: 감사 P 항목 기준, additive 마이그레이션.
- [ ] **전자세금계산서 흐름 점검**: 홈택스 복호화(§3.H) 경로가 새 구조에서 무결한지 통합테스트 + finance_tax_invoices 0행인 이유(인입 경로 가동 여부) 확인.

**M4 종료 기준**: `"demo-project"` 리터럴 전체 0(시드/테스트 제외), 06 문서 체크박스 완료, 전 게이트 green.

---

## 7. M5 — 2026년 11월: 5차 고도화(07) — 지능 고도화

**비즈니스 가치**: 제안·recall 품질이 눈에 띄게 좋아지고, 파이프라인 예측이 경영 대시보드에 등장.

- [ ] **실 임베딩 recall**: 임베딩 백필 재실행(로컬/저비용 경로 우선), DomainMemory 의미검색 품질 A/B(캘리브레이션 방법론 재사용: 층화 샘플 + anti-gaming).
- [ ] **RAG 제안 품질**: 제안서 생성에 유사 과거 케이스 주입 → 컬러게이트 통과율 변화 측정.
- [ ] **예측**: 파이프라인 forecast(가중 파이프라인의 시계열), 일일 리포트에 추세.
- [ ] **LLM 공급 다변화**: 9router 모델 폴백 체인(cx→gemini→ollama 순 등) — zen 한도 사건(7/7) 재발 대비. openai-config에 다중 후보 지원.
- [ ] **다크 스킨(관측소) v2**: DESIGN.md 방향, 계기판 톤 유지.

**M5 종료 기준**: recall A/B 개선 수치 확보, 제안 게이트 통과율 상승, LLM 단일 장애점 제거.

---

## 8. M6 — 2026년 12월: 안정화·감사·확장 결정

**비즈니스 가치**: 1년을 감사 가능한 상태로 마감하고, 2027 확장(멀티프로젝트/조직 확대)을 데이터로 결정.

- [ ] **연간 시스템 정합성 재감사**: 2026-07-03 감사 방법론 재사용(지표/IA/데이터 섬/보안). 결과를 2027 백로그로.
- [ ] **성능·비용 리포트**: LLM 호출량/지연, DB 성장, 백업 무결성 복원 훈련 1회.
- [ ] **보안 마감**: RLS 세분화(백로그 이월분), 시크릿 로테이션, 접근 로그 점검.
- [ ] **멀티프로젝트/테넌시 GO/NO-GO**: 현재 "단일 프로젝트 가정"(리졸버가 유일 행 강제)이 사업 확장과 충돌하는지 판단. GO면 2027-Q1 설계(ADR), NO-GO면 가정 유지 명문화.
- [ ] **2027 로드맵 작성** (이 문서의 후속, 09).

**M6 종료 기준**: 감사 리포트 + KPI 최종표 + 2027 계획 초안.

---

## 9. 인수인계 — 즉시 실행 절차 (다음 세션 첫 30분)

> 현재 boulder: `classifier-calibration-2026-07-07` active, 잔여 체크박스 = "운영" + "Final Wave".

1. **배치 승인 12건**: dev 스택 기동(`scripts/dev-up.sh`) →
   `curl -X POST localhost:3101/api/mail-candidates/batch -H 'content-type: application/json' -d '{"action":"approve","minConfidence":85}'` → count=12 예상(이중게이트) → 승인분 전환(`POST /api/mail-candidates/convert`) → /deals·/customers 확인 → 전후 분포 SQL을 `.agents/results/2026-07-08-calib-ops.md`에 기록.
2. **폴백 529건 재패스**: `/tmp/calib-full-run.sh` 재실행 (763cd95 자가치유 캐시 덕분에 force 불필요 — fallbackReason 있는 것만 자동 재시도. id 목록은 `/tmp/calib-full-ids.txt`, 결과 누적 `/tmp/calib-results.jsonl`). 9router 429 시 동시성 1로 낮추고 시간대 분산. /tmp가 지워졌다면: `packages/business/calib-run.local.ts`(wp-calib 워크트리에 있었음 — 삭제됐다면 ledger의 러너 사양대로 재작성, ~80줄).
3. **Final Wave 판정**: proposed 분포 재채집 → 플랜 체크박스 마감 → boulder completed → wp-calib 워크트리 제거.
4. 이후 M1-W1 항목(§3)으로.

**오늘 세션의 재사용 가능한 패턴** (전부 검증됨): 워크트리 셋업 순서(.env 복사→install→prisma generate→`pnpm -r --filter "./packages/**" build`) · opencode 직구동 시 DATABASE_URL 선주입(.env 읽기 샌드박스 거부) · 장기 작업은 nohup 분리+9분 워처 재무장 · 재검증 강제는 force 옵션 · prod 갱신은 `restart --build` · e2e 로컬은 `PORT=310x API_PORT=320x`.

---

## 10. 상시 트랙 · 리스크 · 비목표

### 상시 (매주)
- KPI SQL 실행 → `.agents/results/kpi/` 적재 (M1-W1부터)
- 승인 큐 위생: needs_human_review 상위 20건 사람 처리 (자율도 표본이 이것으로 쌓인다 — **이 루틴이 M3 자동화의 원료**)
- CI green 확인, DEV_REFERENCE 갱신, 백업 확인

### 리스크 레지스터
| 리스크 | 확률/영향 | 대응 |
|---|---|---|
| LLM 공급 중단(zen 한도 재발·9router OAuth 만료·cx 쿼터) | 중/고 | M5 폴백 체인 선행 가능. 폴백-캐시 자가치유 이미 구현. 비상: ollama 로컬 |
| 상류 데이터 오염(아티팩트 후보) | 중/중 | M1-W1 생성 필터. 재검증 방어선 이미 존재 |
| 스키마 변경 사고 | 저/치명 | migrate-only·additive 규칙 유지, db push 금지, 스냅샷 선행 |
| 에이전트 세션 한도로 작업 중단 | 고/저 | opencode 직구동 + nohup 분리 + .omo 상태 기반 재개 (오늘 3회 실증) |
| 자동화 오판(autopilot) | 중/고 | 저위험 한정, 24h 회수, kill-switch, 뒤집힘율 KPI |
| 단일 운영자 부재 | 중/고 | 00-INDEX 프로토콜 + 증거 체계 + 이 문서. 모든 작업이 문서에서 재개 가능해야 |

### 명시적 비목표 (6개월간 하지 않는다)
멀티테넌시 구현(M6에 결정만) · 모바일 앱 · 외부 SaaS 상품화 · LLM 파인튜닝(RAG/임베딩 우선) · 신규 대형 도메인(법무/HR 등) 추가 · Next/Prisma 메이저 업그레이드(분기 평가만).

---

## 변경 이력
- **2026-07-08**: 최초 작성 — v1 완성(#96~#104) + 분류기 캘리브레이션(#105) 직후. 기준 데이터: proposed 964, 이중게이트 12건 대기, 재무 연결 19/229.
- **2026-07-08 (2차)**: M1 전체를 01 문서 표준(Files/Interfaces/Steps/Acceptance)으로 분해 + §2.5 월별 상세화 프로토콜 신설(M2~M6은 월초에 실측 기반 상세 계획을 생성 후 집행 — 문서 노화 방지).
