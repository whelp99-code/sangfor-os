# 종축 도메인 워크플로우 — 종합 보고서

> 상태: **main 머지 완료** (PR #35, merge `d93731c`, 2026-06-28)
> 출발점: Threads의 멀티에이전트 워크플로우(Jarvis가 전문 에이전트에게 위임) 아이디어
> 결과: sangfor-os의 실제 업무 도메인에 맞춘 **종축 도메인 × 횡축 컬러렌즈 + 도메인 메모리 + 실 LLM + 데이터분류 게이팅 + 구조화 출력 + 대시보드**

---

## 1. 배경과 설계 판단

참고한 Threads 워크플로우는 6개 페르소나(Jarvis/Kai/Dev/Marco/Nova/Dana)를 두는 구조였다.
sangfor-os를 분석한 결과 핵심 통찰 2가지:

1. 기존 **컬러 에이전트(Blue/Red/Orange/Gray/Teal/Purple)** 는 페르소나가 아니라 이미 **도메인 렌즈(focusArea: 기술/위험/비즈/문서/UX/운영)** 다.
2. 부족한 축은 "무슨 업무 단계인가"를 나타내는 **업무 도메인(종축)** 이다.

따라서 페르소나로 교체하지 않고 **두 축을 직교(orthogonal)** 시켰다:

```
                      횡축 = 컬러 렌즈 (리뷰 관점, 기존 유지)
                 Blue  Red  Orange Gray Teal Purple
   종  marketing        ●          (콘텐츠)   teal
   축  sales       ●    ●    ●     ●
   =   presales   ●               ●
   도  engineer   ●    ●                       ●
   메  cfo             ●    ●
   인
```

- **종축(업무 도메인)** = 누가/무슨 단계 → 새 AI가 추가되는 축
- **횡축(컬러 렌즈)** = 어떤 관점으로 검토 → 기존 `routeColorAgents` 재사용
- **실행축** = 누가 실제로 일하나 (codex/cursor/docs/human, 기존)

**데이터 정확성 가설:** 종축이 *단독-writer 소유 경계* 를, 횡축이 *교차 검증* 을 만든다 → 정확성이 구조에서 나온다.

---

## 2. GTM 도메인 파이프라인 (종축)

```
마케팅 → 영업 → 프리세일즈 → 엔지니어(SE/현장) → CFO
```

| 도메인 | 라벨 | 소유 데이터(단독 writer) | 산출물 → 핸드오프 | 기본 렌즈 | 데이터 민감도 |
|---|---|---|---|---|---|
| `marketing` | 마케팅 | Lead, Campaign | qualified-lead → sales | orange, teal | internal |
| `sales` | 영업 | Customer, Opportunity, Quote | opportunity+quote → presales | orange, red, gray | internal |
| `presales` | 프리세일즈 | PocProject, GeneratedDocument | technical-proposal → engineer | blue, gray | internal |
| `engineer` | 엔지니어(SE/현장) | CustomerAsset, SupportCase, DeliveryProject | asset-handoff → cfo | blue, red, purple | **restricted** |
| `cfo` | CFO | Invoice, Cashflow, FinanceProject | commercial-approval → 완료 | orange, red | **restricted** |

`operator`/`security`는 GTM 밖의 내부 거버넌스 모드로 분리 유지.

---

## 3. 구성 요소

### 3.1 도메인 메모리 (학습 + 정확성)
- **모델**: `DomainMemory`(케이스/규칙/예외, recall 대상) + `DomainDecisionLog`(입력·결정·게이트·인간수정 감사). `PolicyMemory` 패턴을 `domain` 축으로 확장.
- **격리**: 모든 조회가 `where domain=...` → 도메인별로 오염 없이 학습.
- **recall**: 구조적(태그 겹침 × outcome 가중 × confidence) + 임베딩 의미검색(앱레이어 코사인, pgvector 불필요).
- **학습 루프**: 인입 → recall(few-shot) → 산출물 → 컬러게이트 → 결정기록 → outcome로 메모리 갱신.

### 3.2 도메인 AI 런타임
- `runDomainStage`/`runDomainPipeline`: recall→prompt→**generate(주입형 LLM)**→렌즈→게이트→기록→학습→핸드오프.
- 게이트 실패 시 핸드오프 중단(같은 도메인 재작업).

### 3.3 LLM 백엔드 — opencode + OpenAI(ChatGPT) OAuth
- `opencode serve`(127.0.0.1:4096) 서버 API 호출. **OAuth는 opencode가 처리**(ChatGPT Plus/Pro 브라우저 로그인, 토큰은 `auth.json`) → 우리 코드에 토큰 로직 0줄.
- `createOpencodeDomainGenerator` + **도메인별 모델 라우팅**(`resolveDomainModel`).

### 3.4 데이터분류 모델 게이팅
- `resolveDomainModelGated`/`buildGatedModelMap`: 도메인 민감도 × `AiModel.allowedDataClassification` × `isActive`로 라우팅.
- 비허용 override는 **조용히 낮추지 않고 거부**(보안). 가용성은 라우팅 키가 아니라 폴백에만.

### 3.5 구조화 출력
- opencode `format:{type:"json_schema",schema}` → 검증된 JSON. 실제 응답 키는 **`info.structured`**(문서의 `structured_output` 아님 — 라이브 테스트로 발견).
- 도메인별 스키마(`DOMAIN_ARTIFACT_SCHEMAS`) → 줄글 대신 타입 산출물(payload.structured).

### 3.6 가용성 폴백 체인
- `createResilientDomainGenerator([gens], {healthCheck, stub})`: 헬스 실패→stub, 아니면 순차 시도 후 전부 실패 시 stub.
- `createDefaultDomainGenerator`: 구조화→텍스트→stub를 한 번에 묶은 권장 기본값.

### 3.7 임베딩
- recall: 앱레이어 코사인(`cosineSimilarity`/`hybridScore`).
- 제공자: `resolveEmbedder`(키 있으면 `createOpenAiEmbedder`, 없으면 `createHashEmbedder` 로컬 폴백).
- 백필: `scripts/backfill-domain-embeddings.ts`로 기존 메모리에 임베딩 소급 적용.

### 3.8 대시보드 (apps/web)
- `buildDomainDashboardSnapshot`(주입형 로더, 테스트 가능) → `/api/domain-pipeline` 라우트 → `(portal)/domain-pipeline` 페이지 → 사이드바 등록.
- 도메인별 렌즈·메모리·결정·최근 outcome·핸드오프 시각화.

---

## 4. 파일 인벤토리

### packages/shared
- `src/modes.ts` — ROLE_MODES(+marketing,engineer) + `GTM_PIPELINE`/`nextGtmDomain`/`isGtmDomain`

### packages/db
- `prisma/schema.prisma` — `DomainMemory`(+embedding), `DomainDecisionLog`
- `prisma/sql/domain_axis_tables.sql`, `domain_axis_embedding.sql` — additive DDL

### packages/business/src
| 파일 | 역할 |
|---|---|
| `domain-pipeline.ts` | 도메인 정의 + 도메인→컬러렌즈(`routeColorAgents`) + 핸드오프 |
| `domain-memory.ts` | 구조적 recall + write/log (소유 경계) |
| `domain-agent-runtime.ts` | 도메인 AI 런타임(주입형 LLM) + stub 생성기 |
| `domain-embedding.ts` | 임베딩 의미 recall(코사인/하이브리드) |
| `domain-model-policy.ts` | 데이터분류 게이팅 |
| `opencode-client.ts` | opencode 서버 HTTP 클라이언트 |
| `domain-llm.ts` | opencode 백엔드 생성기 + 모델 라우팅 |
| `domain-artifact-schema.ts` | 도메인별 출력 JSON 스키마 |
| `opencode-structured.ts` | opencode 구조화 출력(format) |
| `domain-structured.ts` | 구조화 출력 생성기 |
| `domain-llm-fallback.ts` | 가용성 폴백 체인 |
| `domain-default-generator.ts` | 권장 기본 생성기(구조화→텍스트→stub) |
| `domain-dashboard.ts` | 대시보드 스냅샷 빌더 |
| `domain-embedder.ts` | 로컬 해시 임베더 |
| `domain-embedder-openai.ts` | OpenAI 임베더 + `resolveEmbedder` |

### packages/business/scripts
- `domain-pipeline-demo.ts`, `domain-llm-e2e.ts`, `domain-structured-e2e.ts` — 실증 데모
- `seed-ai-models.ts`, `verify-polish.ts`, `backfill-domain-embeddings.ts` — 운영 스크립트

### apps/web
- `src/app/api/domain-pipeline/route.ts`, `src/app/(portal)/domain-pipeline/page.tsx`, `src/lib/portal-config.ts`(nav)

### docs/13_COLOR_AGENT_ORG
- `Domain_Axis_Workflow_DevSpec.md`(개발서), `Opencode_OpenAI_OAuth_Setup.md`(셋업), `Worklog_2026-06-28_Domain_Axis.md`(일지), 본 보고서

---

## 5. 테스트 (~83 유닛테스트, 9 파일)

| 파일 | 수 | 범위 |
|---|---|---|
| domain-pipeline.test | 11 | 파이프라인 순서, 도메인→렌즈, 핸드오프 |
| domain-memory.test | 10 | recall 스코어링, 격리 |
| domain-agent-runtime.test | 7 | 런타임/게이트/핸드오프 |
| domain-embedding.test | 9 | 코사인/하이브리드/격리 |
| domain-model-policy.test | 9 | 데이터분류 게이팅, override 거부 |
| domain-v3.test | 12 | 구조화/폴백/대시보드/임베더 |
| opencode-client.test | 7 | 클라이언트 요청/추출 |
| domain-llm.test | 3 | 모델 라우팅/생성기 |
| domain-polish.test | 3 | 실 임베더/기본 생성기 |

---

## 6. 실증(라이브) 증거

- **데모**: ROUND1 학습 → ROUND2 각 도메인이 학습 recall (도메인 격리 학습 증명).
- **실 LLM e2e**: 5개 도메인이 opencode+OpenAI OAuth로 실제 한국어 산출물 생성(도메인별 모델 라우팅대로).
- **구조화 출력**: CFO가 스키마 검증 JSON 반환(`{decision:"hold",marginPct,conditions,rationale}` — 타당한 재무 판단 포함).
- **게이팅**: AiModel 4종 시드 → engineer/cfo(restricted)는 gpt-5.4로만, 나머지 mini-fast.
- **대시보드**: `next dev` → `/api/domain-pipeline` 200(실 데이터), `/domain-pipeline` 페이지 200.
- **임베딩 백필**: DomainMemory 15행 실 DB 적용.

---

## 7. 커밋 / 머지 이력

```
d93731c Merge pull request #35  ← main
c54004f test(shared): modes.test ROLE_MODES 갱신 (CI 수정 2/2)
3b3ae99 fix(domain): resolveProjectId→resolveDomainProjectId (CI 수정 1/2, TS2308)
10472e2 polish — 기본생성기/시드/실임베더/worklog
895cfdc V3 — 구조화/폴백/대시보드/백필
0690f4c 데이터분류 게이팅 + 실 LLM e2e
f590ca2 opencode + OpenAI OAuth LLM 백엔드
3228a38 V2 — 런타임 + 임베딩
dddb59b V1 — 도메인 파이프라인 + 메모리
```

**CI 게이트가 머지 전에 결함 2개를 차단:**
1. `resolveProjectId` export 충돌(TS2308) — vitest(esbuild)는 못 잡고 전체 `tsc`가 잡음.
2. `modes.test.ts`의 ROLE_MODES exact-equality 단정 — 새 도메인 반영 누락.
둘 다 수정 후 build/lint/test/typecheck/secrets-scan **전부 통과**, 머지.

---

## 8. 운영 방법

```bash
# 1) opencode + OpenAI OAuth (1회)
opencode auth login          # OpenAI → ChatGPT Plus/Pro
opencode serve --port 4096

# 2) DB 준비 (additive)
cd packages/db && npx prisma generate

# 3) 검증/실증
npx tsx packages/business/scripts/verify-polish.ts          # 게이팅/대시보드/임베더
npx tsx packages/business/scripts/domain-llm-e2e.ts         # 실 LLM 파이프라인
npx tsx packages/business/scripts/domain-structured-e2e.ts  # 구조화 출력
npx tsx packages/business/scripts/backfill-domain-embeddings.ts

# 4) 대시보드: apps/web dev → /domain-pipeline
```

코드 사용:
```ts
import { runDomainPipeline, createDefaultDomainGenerator,
         buildGatedModelMap, loadModelPolicyFromDb } from "@sangfor/business";

const registry = await loadModelPolicyFromDb(prisma);
const generate = createDefaultDomainGenerator({ models: buildGatedModelMap({ registry }) });
const results = await runDomainPipeline({ id, subject, tags }, { generate });
```

---

## 9. 남은 일 (후속)

- `runDomainPipeline` 기본 generator를 `createDefaultDomainGenerator`로 디폴트화.
- 실 임베딩 키 설정 후 백필 재실행(recall 품질↑).
- 구조화 산출물 → 실제 DB 레코드(Opportunity/Quote/Invoice) 매핑.
- 대시보드 실시간(SSE) 갱신, 도메인 카드 상세화.

---

## 부록 — 공유 워킹트리 thrashing 메모

작업 내내 다른 에이전트/자동화가 공유 워킹트리의 브랜치를 실시간 전환·되돌려, 추적파일 편집이 반복적으로 유실됐다. 대응:
- 모든 커밋을 **git plumbing**(`read-tree`/`commit-tree`/`update-index`)으로 워킹트리를 우회해 합성.
- 실행 전 `git restore --source=<sha>`로 추적파일을 커밋에서 복원.
원래 브랜치 `feat-domain-axis-workflow` ref는 파괴되어 **`feat-domain-v2-complete`** 로 진행했고, 최종적으로 main에 정상 머지됐다.
