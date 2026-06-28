# 개발서 — 도메인 축 워크플로우 (Domain × Color-Lens 2축 구조)

> Status: Proposed · Owner: AI Automation · Scope: V1 골격(domain 축 + domain memory)

## 1. 배경 / 문제

현재 에이전트 역할은 **컬러 렌즈(Blue/Red/Orange/Gray/Teal/Purple)** 하나의 축으로만 구분돼 있다.
컬러는 사실 페르소나가 아니라 이미 도메인 *렌즈(리뷰 관점)* 다 (`packages/business/src/color-agent.ts`의 `focusArea`).

부족한 것은 **"무슨 업무 단계인가"를 나타내는 종축(업무 도메인)** 이다. 영업 생애주기를 따라
마케팅 → 영업 → 프리세일즈 → 엔지니어(SE/현장) → CFO 로 일이 흐르지만, 이 흐름이 코드에 없다.

## 2. 목표

1. **종축 = 업무 도메인 파이프라인** 을 도입한다 (`marketing → sales → presales → engineer → cfo`).
2. **횡축 = 컬러 렌즈** 는 변경 없이 재사용한다 (`routeColorAgents`). 두 축은 직교.
3. 각 도메인이 자기 데이터만 책임지는 **도메인 메모리** 로 *데이터 정확성* 과 *점진적 학습* 을 만든다.
4. 도메인 AI 추가가 기존 도메인/렌즈를 건드리지 않고 **확장 가능** 하도록 한다.

## 3. 2축 구조

```
                     횡축 = 컬러 렌즈 (리뷰 관점, 변경 없음)
              Blue  Red  Orange Gray Teal Purple
  종 marketing       ●          (콘텐츠/리드)        teal
  축 sales      ●    ●    ●     ●
  =  presales  ●               ●
  도 engineer  ●    ●                       ●
  메 cfo            ●    ●
  인
```

- **종축(도메인)**: 누가/무슨 단계인가 → 신규 AI가 추가되는 축. `@sangfor/shared` `ROLE_MODES`.
- **횡축(렌즈)**: 어떤 관점으로 검토하나 → 기존 `ColorKey` 6개 재사용.
- 도메인이 N개로 늘어도 렌즈는 6개 그대로 → 리뷰 체계 불변.

## 4. 도메인 정의 (각 도메인 = 미래의 독립 AI)

| 도메인 | 라벨 | 소유 데이터(단독 writer) | 산출물 → 핸드오프 | 기본 렌즈 |
|---|---|---|---|---|
| `marketing` | 마케팅 | Lead, Campaign | qualified lead → sales | orange, teal |
| `sales` | 영업 | Customer, Opportunity, Quote | 기회+견적 → presales | orange, red, gray |
| `presales` | 프리세일즈 | PocProject, GeneratedDocument(제안) | 기술제안 → engineer | blue, gray |
| `engineer` | 엔지니어(SE/현장) | CustomerAsset, SupportCase, DeliveryProject | 구축완료 → cfo | blue, red, purple |
| `cfo` | CFO | Invoice, Cashflow, FinanceProject | 상업승인 → (완료) | orange, red |

> `operator` / `security` 는 GTM 파이프라인 밖의 **내부 거버넌스 모드** 로 분리 유지(AI화 대상 아님).
> 기존 `delivery` / `support` 는 `engineer` 도메인의 내부 산출물 모델로 흡수(역할 라벨은 engineer).

## 5. 도메인 메모리 아키텍처

기존 `PolicyMemory` / `PolicyDecisionLog` 패턴을 **도메인 축으로 확장**한다 (바퀴 재발명 금지).

### 5.1 2계층 구성
| 계층 | 모델 | 역할 |
|---|---|---|
| ① 사실 기록 | `DomainMemory` | 도메인별 케이스/규칙/예외 (단독 writer = `domain` 컬럼) |
| ② 결정 로그 | `DomainDecisionLog` | 입력·결정·게이트결과·인간수정 감사 추적 |

### 5.2 Prisma 모델 (`packages/db/prisma/schema.prisma`)
- `DomainMemory(projectId, domain, memoryType, key)` unique, `tags[]`, `valueJson`, `outcome`, `confidence`, `status`.
- `DomainDecisionLog(projectId, domain, caseRef, decisionType, inputJson, outputJson, colorGateJson, humanEditJson, outcome)`.
- `embedding` 은 V1 미포함 — 메인 DB에 pgvector 미설치. **V2 훅** 으로 남김(아래 9).

### 5.3 학습 루프
```
인입 → recall(domain, tags) → 유사 케이스 few-shot 주입 → 산출물 생성
     → color gate → DomainDecisionLog 기록 → outcome/humanEdit 으로 DomainMemory 갱신
```
- **격리 학습**: `where domain=...` 로 도메인별 메모리만 조회 → 오염 없는 학습.
- **공짜 라벨**: 컬러게이트 pass/fail 이 곧 좋은/나쁜 산출물 라벨 → 추후 파인튜닝 데이터.

### 5.4 V1 recall 방식
임베딩 없이 **구조적 recall**: 같은 `domain` 후보 중 `tags` 겹침 + 최신성 + outcome 가중으로 top-K. (순수 함수, DB 불필요로 테스트 가능)

## 6. 오케스트레이션 흐름

```
인입 → [Orchestrator] 도메인 분류
     → 도메인 AI 산출물 생성 (memory recall 보강)
     → routeColorAgents(domain preset) → checkColorGate
     → 통과: buildHandoffDraft → nextDomain  / 실패: 같은 도메인 재작업
```
핸드오프·게이트는 기존 `routeColorAgents` / `checkColorGate` / `KanbanHandoffCard` 재사용.

## 7. 변경 범위 (V1)

| 파일 | 변경 |
|---|---|
| `packages/shared/src/modes.ts` | `marketing`, `engineer` 도메인 + `GTM_PIPELINE` 순서 + MODE_MATRIX 항목 |
| `packages/db/prisma/schema.prisma` | `DomainMemory`, `DomainDecisionLog` 모델 + Project 역관계 |
| `packages/business/src/domain-pipeline.ts` | 도메인 정의 + 도메인→렌즈(`routeColorAgents`) + `nextDomain` |
| `packages/business/src/domain-memory.ts` | write/recall(구조적) + DB 헬퍼 |
| `*.test.ts` | 파이프라인 라우팅 + recall 스코어링 순수함수 테스트 |

## 8. 비범위 (V1 제외)

- 도메인별 실제 AI 실행 런타임(프롬프트/툴 바인딩) — 골격만, 런타임은 후속.
- 임베딩 기반 의미 recall — V2.
- apps/web 대시보드 종축 시각화 — 후속.

## 9. V2 훅 (확장 지점)

- **임베딩 recall**: 메인 DB에 pgvector 활성화 또는 기존 `services/sangfor-engineer-mcp/packages/sangfor-rag` 임베딩 provider 재사용. `DomainMemory.embedding` 컬럼 추가.
- **도메인 AI 추가**: `ROLE_MODES` 1줄 + `MODE_MATRIX` 1항목 + `DOMAIN_DEFINITIONS` 1항목 → 기존 도메인/렌즈 무변경.

## 10. 데이터 정확성 근거 (설계 가설)

종축이 **소유·책임 경계** 를, 횡축이 **교차 검증** 을 만든다.
- 단독 writer → 데이터 오염/충돌 차단.
- 좁은 컨텍스트 → 환각 감소.
- 명시적 핸드오프 → 출처 추적.
- 직교 렌즈 → 교차 검증.
