# 작업 일지 — 2026-06-28 · 종축 도메인 워크플로우

> 한 줄: Threads 멀티에이전트 워크플로우 아이디어를, sangfor-os의 **실제 업무 도메인(종축) × 컬러 렌즈(횡축) + 도메인 메모리 + 실 LLM(opencode/OpenAI OAuth) + 대시보드**로 구현해 한 바퀴 완성.

## 결과물
- **브랜치 `feat-domain-v2-complete`** (HEAD 는 아래 커밋 체인의 마지막)
- 커밋 체인: `dddb59b`(V1) → `3228a38`(V2) → `f590ca2`(LLM 백엔드) → `0690f4c`(게이팅+e2e) → `895cfdc`(V3 4종) → `(이 커밋)`(다듬기+worklog)
- 누적 **~83 유닛테스트** + 실 LLM/실 DB/라이브 대시보드 실증 다수
- ⚠️ 작업 내내 **공유 워킹트리 thrashing**(다른 에이전트가 브랜치를 계속 전환·되돌림) 발생 → 모든 커밋을 **git plumbing(read-tree/commit-tree)** 으로 워킹트리 우회 합성. 받을 때 `git checkout feat-domain-v2-complete`.

## 단계별 내용

### 1) 설계 결정
- 컬러 렌즈는 페르소나가 아니라 이미 **도메인 렌즈(focusArea)**. 교체하지 않고 **렌즈(횡축) × 업무도메인(종축)** 직교 매트릭스로.
- 종축 = GTM 파이프라인: **마케팅 → 영업 → 프리세일즈 → 엔지니어(SE/현장) → CFO**.
- 데이터 정확성 = 도메인별 **단독-writer 소유 경계** + 횡축 교차검증.

### 2) V1 (dddb59b)
- `shared/modes.ts`: `marketing`,`engineer` 도메인 + `GTM_PIPELINE`/`nextGtmDomain`.
- `DomainMemory`/`DomainDecisionLog` Prisma 모델(PolicyMemory 패턴 확장, **additive SQL**; `db push --accept-data-loss` 금지 — 메일 데이터 보호).
- `domain-pipeline.ts`(도메인→렌즈 `routeColorAgents` 재사용, 핸드오프), `domain-memory.ts`(구조적 recall).
- 실증: 데모로 ROUND1 학습 → ROUND2 recall 증명.

### 3) V2 (3228a38)
- `domain-agent-runtime.ts`: 도메인 AI 런타임(주입형 LLM) — recall→prompt→generate→렌즈→게이트→기록→학습→핸드오프.
- `domain-embedding.ts`: 앱레이어 코사인 의미 recall(+`DomainMemory.embedding`).

### 4) LLM 백엔드 (f590ca2)
- `opencode-client.ts` + `domain-llm.ts`: **opencode 서버 + OpenAI(ChatGPT) OAuth**. OAuth 토큰은 opencode가 관리(우리 코드 0줄). 도메인별 모델 라우팅.
- 셋업: `docs/13_COLOR_AGENT_ORG/Opencode_OpenAI_OAuth_Setup.md`.
- **실 LLM e2e 성공**: 5개 도메인이 NGAF 케이스로 실제 한국어 산출물 생성.

### 5) 데이터분류 게이팅 (0690f4c)
- `domain-model-policy.ts`: 도메인 민감도 × `AiModel.allowedDataClassification`로 라우팅. 비허용 override **거부(조용한 다운그레이드 금지)**.

### 6) V3 4종 (895cfdc)
- **② 구조화 출력**: opencode `format` → `info.structured`(문서의 `structured_output` 아님 — 라이브로 버그 발견·수정). CFO 도메인 타입 산출물 실증.
- **① 폴백 체인**: `createResilientDomainGenerator`(health→primary→fallback→stub).
- **④ 대시보드**: `buildDomainDashboardSnapshot` + `/api/domain-pipeline` + `(portal)/domain-pipeline` + 사이드바.
- **③ 임베딩 백필**: `createHashEmbedder`(로컬, 무 API) + 백필 스크립트(15건 실 DB 채움).

### 7) 다듬기 (이 커밋)
- **기본 생성기**: `createDefaultDomainGenerator`(구조화→텍스트→stub, health 폴백) — 파이프라인 권장 기본값.
- **AiModel 시드**: `scripts/seed-ai-models.ts`(4모델 실 등록). 게이팅 실증 — engineer/cfo(restricted)는 gpt-5.4로만, 나머지는 mini-fast.
- **실 임베딩 제공자**: `domain-embedder-openai.ts`(`createOpenAiEmbedder`+`resolveEmbedder`; 키 있으면 OpenAI, 없으면 hash). 백필도 `resolveEmbedder` 사용.
- **대시보드 라이브 검증**: `next dev` → `/api/domain-pipeline` **HTTP 200**(실 데이터), `/domain-pipeline` 페이지 **200**(heading 확인).

## 재현 방법
```bash
git checkout feat-domain-v2-complete
cd packages/db && npx prisma generate
# 게이팅/대시보드/임베더 검증
npx tsx packages/business/scripts/verify-polish.ts
# 실 LLM 파이프라인 (opencode OAuth 필요)
opencode serve --port 4096 &
npx tsx packages/business/scripts/domain-llm-e2e.ts
npx tsx packages/business/scripts/domain-structured-e2e.ts
# 대시보드: apps/web dev → /domain-pipeline
# 임베딩 백필
npx tsx packages/business/scripts/backfill-domain-embeddings.ts
```

## 남은 일 (후속)
- `runDomainPipeline` 기본 generator 를 `createDefaultDomainGenerator` 로 디폴트화(현재는 명시 주입).
- 실 임베딩 제공자로 backfill 재실행(키 설정 시) — recall 품질 향상.
- 구조화 산출물 → 실제 DB 레코드(Opportunity/Quote/Invoice) 매핑.
- 공유 워킹트리 thrashing 원인(동시 실행 에이전트) 정리 후 PR 머지.
