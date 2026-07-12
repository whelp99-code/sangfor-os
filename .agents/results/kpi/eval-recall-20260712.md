# M5 Task 1 — 실임베딩 전환 + recall 품질 측정 (2026-07-12)

## 임베딩 백엔드 결정 (Step 1)
9router(:20128)에 임베딩 전용 모델 0개(실측: `/v1/models` 81개 전부 chat/completion, `/v1/embeddings`는 `No credentials for provider: openai`로 실패). 사용자 결정 = **로컬 ollama `nomic-embed-text`** (768d, 제로비용·오프라인).

- 배선: `EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1`, `EMBEDDING_MODEL=nomic-embed-text` (`.env`). `resolveEmbedder`가 임베딩 엔드포인트를 채팅 9router와 분리해 우선 사용.
- 검증: `describeEmbedder()=embedding-endpoint`, 백필 6/6행 → DB에 768차원 실임베딩 저장 확인.

## 백필 (Step 3)
`domain_memories` 6행(presales 3, sales 3) 전부 nomic 768d로 재임베딩(멱등, skip 0).

## hit@5 측정 (Step 2 전 / Step 4 후) — 평가셋 n=6
평가셋: DomainMemory 전 행 leave-one-out, 정답=동일 도메인 태그겹침 peer. baseline=태그전용(임베딩 null), semantic=nomic.

### recallHybrid negative-learning fix **이전** (버그 노출)
| domain | memories | baseline hit@5 | semantic hit@5 |
|---|---|---|---|
| presales | 3 | 100% | 100% |
| sales | 3 | 0% | **100%** ← 버그 |
| **ALL** | 6 | **50%** | **100%** |

sales 3건은 전부 `outcome=rejected`. 태그 경로는 negative-learning으로 억제(0%)하지만, 임베딩 경로(`recallHybrid`)에 억제가 **없어** 의미유사도로 되살림 → "100%"는 개선이 아니라 **사람이 반려한 메모리를 재추천하는 거버넌스 버그**.

### fix **이후** (교정)
| domain | memories | baseline hit@5 | semantic hit@5 |
|---|---|---|---|
| presales | 3 | 100% | 100% |
| sales | 3 | 0% | 0% |
| **ALL** | 6 | **50%** | **50%** |

## 판단 (Acceptance)
- **의미 있는 recall 개선은 이 데이터셋(n=6)으로 측정 불가**: presales 3건은 태그가 이미 겹쳐 semantic 이득 없음, sales 3건은 반려라 억제됨. "태그 무겹침 approved" 케이스가 없어 semantic이 기여할 여지가 데이터에 없다. 스파인에 실딜 메모리가 쌓이면 하네스(`eval-recall.ts`)가 즉시 유효 수치를 낸다.
- **이번 실행의 실제 산출물 = 거버넌스 버그 발견·수정**: `recallHybrid`/`hybridScore`가 `recallDomainMemories`의 negative-learning 억제 2겹(음수 score 필터 + cross-candidate suppression)을 모두 누락. 실임베딩을 프로덕션 recall에 배선하기 전 반드시 필요한 fix. 회귀 테스트 3종 추가(hybridScore rejected/human-reverted 억제, recallHybrid cross-suppression).
- 롤백 불요: 인프라·fix 모두 유지. 프로덕션 recall 경로(`domain-proposal.ts`가 쓰는 `recallDomainMemories`)를 `recallSemanticFromDb`로 전환하는 것은 **별도 후속**(데이터 축적 후 수치 정당화 시).

## 남은 것
- 런타임 recall을 hybrid로 전환(데이터 축적 후).
- ollama 자동기동(현재 수동 `ollama serve`) — 프로덕션/크론에서 임베딩 쓰려면 launchd 등록 필요.
- 기존 flaky 테스트 3종(daily-report/domain-proposal/mail-candidates)은 실 9router 호출 의존 — 본 작업과 무관, 별도 격리 필요.
