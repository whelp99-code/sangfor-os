# 5차 고도화 계획서 — 지능 고도화: 임베딩·RAG·파인튜닝·예측·다크스킨 (07)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans + test-driven-development. 이 차수는 모델 품질 작업이 많다 — 모든 품질 주장(recall 개선, 게이트 정확도)은 **수치 전후 비교**로만 인정된다(02 검증서 §1). 착수 전 `00-INDEX.md` §3 필독.

**Goal:** 축적된 실데이터(메일 1,700+건, 결정 로그, 사람 수정 이력)를 지능으로 환류 — ①recall이 실임베딩으로 정확해지고, ②엔지니어 RAG가 기술지원에 연결되고, ③사람 수정 쌍이 파인튜닝 데이터셋으로 쌓이고, ④예측(리스크·이탈)이 계기판에 뜨고, ⑤다크 스킨(v2)으로 디자인이 완성되는 상태.

**선행 조건:** 4차 고도화 완료 (LLM 계측이 있어야 품질 비교 가능, 폴더 구조 확정 후라 파일 경로 안정).

**전역 제약:** 00-INDEX §3 + 예측·자동화의 정직성: 확신도가 낮은 예측은 낮다고 표기(계기는 정직 — 가짜 정밀도 금지). 파인튜닝 데이터에 개인정보·재무 민감 필드 포함 금지(데이터분류 게이팅 원칙 준수).

---

## Task 1: 실임베딩 전환 + recall 품질 측정

**Files:** Modify: `packages/business/src/domain-ai/domain-embedder-openai.ts`(`resolveEmbedder`), 백필: `packages/business/scripts/backfill-domain-embeddings.ts`(기존)
- [ ] **Step 1: 임베딩 백엔드 확정** — 9router가 임베딩 엔드포인트를 지원하는지 확인(`curl http://127.0.0.1:20128/v1/embeddings` 시험). 지원하면 그대로(제로비용), 아니면 로컬 임베딩 서버(예: ollama nomic-embed) 또는 유료 키 — 사용자 확인 필요(비용 결정).
- [ ] **Step 2: 기준선 측정(전환 전)** — recall 품질 하네스 작성 `packages/business/scripts/eval-recall.ts`: DomainMemory에서 평가셋 추출(케이스 50건, 각각 "이 케이스와 관련된 메모리" 정답을 태그 겹침으로 근사) → 현 해시 임베더의 hit@5 기록.
- [ ] **Step 3: 전환 + 전체 백필** — `resolveEmbedder`가 실임베더 우선 사용, 백필 스크립트로 전 DomainMemory 재임베딩(멱등, 실패 행 리포트).
- [ ] **Step 4: 후측정** — 같은 하네스로 hit@5 전후 비교. 개선 없으면 원인 분석(임베딩 모델·차원·태그 근사 정답의 한계)을 기록하고 롤백 여부 판단.
**Acceptance:** 전후 수치 비교표. 개선이 있든 없든 수치와 판단이 증거 파일에 존재.

## Task 2: 엔지니어 RAG 통합 (기술지원 ↔ sangfor-engineer-mcp)

**배경:** `services/sangfor-engineer-mcp`에 RAG 전용 스키마(SangforRagDocument/Chunk, SangforManual 등)와 브리지(:3600)가 있고, web에 `POST /api/engineer/rag`가 있으나 화면 연결이 약하다.
- [ ] **Step 1: 현 배선 조사** — `apps/web/src/app/api/engineer/rag/route.ts`가 실제로 MCP 브리지를 호출하는지, RAG 문서가 몇 건 적재돼 있는지(`make up` 후 브리지 헬스 + DB count) 확인. stub이면 여기까지의 실배선이 이 태스크의 본체.
- [ ] **Step 2: 기술지원 화면 통합** — `/support` 케이스 상세에 "관련 지식" 패널: 케이스 제목/증상으로 RAG 조회 → 상위 3청크 + 출처(매뉴얼/과거 케이스) 렌더. 응답 없으면 패널 숨김(빈 패널 금지).
- [ ] **Step 3: 도메인 AI 연결** — engineer 도메인 `runDomainStage`의 recall에 RAG 결과를 컨텍스트로 주입(주입형 구조라 `generate` deps에 추가 — 스파인/게이트 로직 무변경).
- [ ] **Step 4: 지식 환류** — 해결된 SupportCase의 해결책을 `SangforFeedbackEvent`→위키 업데이트 제안(`SangforWikiUpdateProposal`) 경로로 적재(사람 승인 후 반영 — human-in-loop 유지).
**Acceptance:** 실케이스 1건에서 관련 지식 패널이 실제 매뉴얼 청크를 보여주는 스크린샷 + engineer 도메인 제안 품질에 RAG 컨텍스트가 포함된 로그.

## Task 3: 파인튜닝 데이터셋 파이프라인 (사람 수정 쌍 환류)

**배경:** 스파인에 "AI 초안 → 사람 수정본" 쌍이 쌓인다(decisionType=human_review, outcome=modified). 이것이 이 제품의 해자다 — 모델이 회사 말투·판단 기준을 배우는 원료.
**Files:** Create: `packages/business/src/domain-ai/finetune-export.ts`(+test), 스키마는 기존 `SangforFineTuneDataset/Job`(engineer-mcp) + `AiGoldenAnswer`(main) 재사용
- [ ] **Step 1: 추출기** — `exportFinetunePairs({ domain?, since? })`: 스파인에서 (입력 컨텍스트, AI 초안, 사람 최종본, 렌즈 verdict) 쌍 추출 → chat-format JSONL. **필터**: 재무 수치·주민/사업자번호·이메일 원문 개인정보는 마스킹(테스트로 보장), 표본 품질(수정폭 극소/극대 제외).
- [ ] **Step 2: 골든셋 승격** — 사람이 3회 이상 동일 패턴으로 수정한 케이스는 `AiGoldenAnswer`로 승격해 회귀 평가셋으로(기존 AI 품질 평가 모델 재사용).
- [ ] **Step 3: 평가 하네스** — `eval-domain-quality.ts`: 골든셋에 대해 현행 생성기 출력을 5렌즈 LLM 게이트로 채점 → 도메인별 점수 기준선 기록. (실제 파인튜닝 잡 실행은 모델 백엔드 결정이 필요한 별도 사람 결정 — 이 차수는 데이터셋·평가까지.)
**Acceptance:** JSONL 내보내기(마스킹 테스트 green) + 골든셋 n건 + 도메인별 품질 기준선 표.

## Task 4: 예측 계기 (리스크 스코어·리뉴얼 이탈)

**원칙:** 통계로 시작(단순 로지스틱/규칙 스코어), ML은 표본이 정당화할 때만. 1차 고도화 ADR-002에서 이관된 `segment`/`riskScore`류 컬럼 추가는 여기서 수행(additive 마이그레이션).
- [ ] **Step 1: 딜 리스크 스코어** — `packages/business/src/crm/deal-risk.ts`(+test): 입력(스테이지 체류일, 메일 응답 공백일, 렌즈 fail 이력, 금액) → 0~100 스코어 + **기여 요인 목록**(설명 없는 점수 금지). 순수 함수 TDD.
- [ ] **Step 2: 리뉴얼 이탈 조기경보** — 만료 D-90 시점의 활동 신호(최근 지원 케이스 감정, 메일 빈도)로 3단계(안전/주의/위험). 와치독(3차 Task 5)의 태스크 생성에 단계 반영.
- [ ] **Step 3: 계기판 노출** — 딜 상세·리뉴얼 화면에 스코어+요인 표시(5색 아님 — 예측은 중립 재질, DESIGN.md 준수). 대시보드에 "주의 딜" 위젯.
- [ ] **Step 4: 캘리브레이션 루프** — 분기마다 예측 vs 실결과(수주/실주/이탈) 대조표를 자동 생성(스케줄 잡) — 예측 계기가 정직한지 스스로 검증.
**Acceptance:** 스코어 순수 함수 테스트 green + 실데이터 분포(전 딜 스코어 히스토그램)가 극단 쏠림 없이 유의미 + 요인 설명 렌더.

## Task 5: 컬러게이트 캘리브레이션 (게이트 vs 사람 일치율)

- [ ] 대조 하네스: 최근 사람 결정(승인/수정/반려)과 해당 제안의 LLM 게이트 verdict를 대조 — 게이트 pass인데 사람 반려(false negative), 게이트 fail인데 사람 승인(false positive) 비율 산출.
- [ ] 불일치 상위 패턴을 렌즈 프롬프트(`color-gate-llm.ts`의 `LENS_DEF`/system)에 반영(예: 특정 도메인에서 orange 과민). 프롬프트 버전을 verdict에 기록해 버전별 일치율 추적.
- [ ] 3차 자동승인 임계(`requireColorGatePass`)의 근거 수치로 사용 — 일치율<80% 도메인은 auto 승격 금지 권고를 정책 화면에 표시.
**Acceptance:** 도메인별 일치율 표 + 프롬프트 v2 전후 비교.

## Task 6: 다크 스킨(관측소) v2 + 알림 채널

- [ ] **다크 스킨**: `DESIGN.md`의 "관측소" 방향으로 다크 토큰 세트 설계(§색상 토큰의 다크 대응 — 5색 검증 채널의 명도 재보정 필수, WCAG 2.2 AA 유지) → `DESIGN.md`에 다크 절 추가(디자인 정본 먼저) → CSS 토큰 구현 → 전 계기판 화면 다크 렌더 스크린샷 검증. frontend-design 스킬 사용, 사용자 디자인 감도 높음(중간 목업 확인 권장).
- [ ] **알림 채널**: 브리핑·와치독·autopilot 요약을 메일로 발송(기존 Outlook 연동의 송신 스코프 확인 — `Mail.Send` 미허용이면 사용자 OAuth 재동의 필요, 사람 확인 후). 발송은 하루 1회 다이제스트 기본(스팸화 금지).
**Acceptance:** 다크 모드 전 화면 AA 대비 검증 + 실제 수신된 브리핑 메일 1통.

---

## 5차 고도화 종료 게이트

- [ ] 전 태스크 PR 머지, 02 검증서 §4 전체 실행.
- [ ] **최종 KPI 대조** (3차 기준선 대비): 자동화율, 뒤집힘율, 후보 리드타임, recall hit@5, 게이트-사람 일치율, 도메인 품질 점수 — 표 1장으로 종합.
- [ ] `docs/DEV_REFERENCE.md` 대갱신 + memlog 기록.
- [ ] **차기 사이클 입력 작성**: 이 문서 묶음의 미이월 backlog + KPI가 가리키는 다음 병목을 `docs/master-plan/next-cycle-seeds.md`로 정리 — 6차 이후 계획의 씨앗.
