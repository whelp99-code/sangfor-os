# 2026-07-14 주간 실사용 + 후속 계획

**작성:** 2026-07-12 (세션 종료 시점) · **대상 기간:** 2026-07-14 ~ 07-20 (실사용 1주)

## 0. 목적
다음 1주일 제품을 **실제로 사용**하면서 데이터를 쌓아, 지금까지 "데이터 부족"으로 막힌 지능 기능들을 유효화한다. 이번 세션에서 M5 지능 기능(임베딩·엔지니어RAG·계측·deal-risk)의 **코드는 완주**했으나, 스파인 데이터가 얇아(DomainMemory 6행, 프로즈 수정쌍 0, 딜 신호 미성숙) 측정·품질이 정당화되지 않았다. 실사용이 그 공백을 메운다.

## 1. 환경 상태 (2026-07-12 정리 완료 — CONFIRMED)
- **prod 런타임(main-fork)** = `origin/main` 최신 `70548f9`(PR #128~132 전부 반영), 미커밋 0.
- **공유 DB**(`localhost:5434/sangfor_os`) 마이그레이션 `up to date`(37개, 세션 중 이미 적용).
- **prod 스택 재기동 검증**: web :3100 →200, api :3210/health →200, dev :3101/:3200 병행(boot-stack launchd).
- **워크트리 2개**: `Playground/sangfor-os`(dev, main 최신 정렬), `orca/.../main-fork`(prod). stale card 워크트리 2개 제거됨.
- **브랜치 2개**: `main`, `dev-clean`(= origin/main). 머지된 stale 로컬 브랜치 10개 삭제. 원격은 `origin/main`만(모든 feature 브랜치 --delete-branch로 정리됨).
- **크론(launchd) 유지**: backup 21:00, revalidate-batch 22:30, mail-sync/classify, learnall/learnkb, autopilot, daily-briefing, ollama(KeepAlive).

## 2. 실사용 데이터 축적 프로토콜 — "무엇을 하면 무엇이 풀리나"
| 사용 행동 | 축적 데이터 | 유효화되는 후속 |
|---|---|---|
| 실 딜에서 도메인 AI 제안 생성·승인·**수정** | DomainMemory, DomainDecisionLog, color-gate verdict | recall hit@5 측정(M5 Task1), 게이트 캘리브레이션(M5 Task5) |
| AI 생성 문서(제안서 등)를 **편집** | DocumentVersion(초안→최종 diff) | 파인튜닝 프로즈 쌍(M5 Task3) |
| 딜을 실제로 진행(스테이지 이동, 메일 왕래, close date) | 딜 dwell·mailSilence·overdue 신호 | deal-risk 분포 성숙(M5 Task4) |
| 리뉴얼 등록·관리 | renewal_opportunities(현 0) | 리뉴얼 이탈 경보(M5 Task4 Step2) |
| 기술지원 케이스 등록·해결 | SupportCase, 위키 제안 | 엔지니어 RAG 실사용 검증(M5 Task2) |
| LLM 호출 발생(제안·분류·게이트) | llm_calls(실 토큰·지연) | 계측 대시보드 유의미(M4 Task4) |

## 3. 후속 백로그 (데이터 성숙 후 착수 — 우선순위순)
1. **M5 Task1 런타임 recall 전환**: `recallDomainMemories`→`recallSemanticFromDb`(hybrid). 조건: DomainMemory 충분(현 6). 하네스 `packages/business/scripts/eval-recall.ts` 준비됨 — 주기적으로 hit@5 측정해 전환 시점 판단.
2. **M5 Task4 deal-risk 마무리**: Step2 리뉴얼 이탈(renewal 데이터 필요), Step4 캘리브레이션 스케줄 잡, mailSilence/lensFail 딜별 배선(현 null/0 주입), riskScore 영속화 컬럼(현 compute-on-read).
3. **M5 Task5 게이트 캘리브레이션**: color-gate verdict 30→충분 후. 게이트 pass vs 사람 승인/반려 일치율, 렌즈 프롬프트 v2.
4. **M4 계측 확대**: 현재 color-gate만 계측 배선 → daily-report/domain-proposal/classify-ai/skill-runner/chatbot(apps/api rogue) 배선. **stale llm_calls 목 행 7개(1200/400/850) 정리**(삭제 승인 필요).
5. **M5 Task2 마무리**: 각 환경서 `pnpm run rag:reembed`(인덱스 gitignore·로컬), 위키 승인 플로(MANUAL HMAC `SANGFOR_WIKI_APPROVAL_SECRET`), rag-search 400 에러 포맷 정합.
6. **M5 Task3 파인튜닝**: DocumentVersion 프로즈 쌍 축적 후. **PII 마스킹 유틸 신규 필요**(재무 수치·사업자/주민번호·이메일 — 저장소에 부재).
7. **M5 Task6 다크스킨 v2 + 알림 채널**: 디자인 작업(사용자 디자인 민감 — 목업 확인), 브리핑 메일 발송(Outlook `Mail.Send` 스코프 재동의 필요).

## 4. 주간 리스크 / 관찰 항목
- **공유 DB 오염 위험**: dev(:3101/:3200)와 prod(:3100/:3210)가 **같은 `sangfor_os` DB**를 씀. dev에서 만든 테스트 데이터가 실사용 데이터를 오염시킬 수 있음 → **실사용 중엔 dev 스택 쓰기 자제 또는 정지 권장**([[local-prod-runtime]]).
- **project_id 'demo' 오염**: 실사용 데이터는 실 프로젝트 slug에 저장돼야 함. demo-project 리터럴 재유입 감시(W-C sweep 기준선 유지).
- **임베딩 재생성 비영속**: engineer-mcp `data/rag/index.json`(ollama nomic-embed 재임베딩분)은 gitignore·로컬. 재부팅/환경 이동 시 `rag:reembed` 재실행 필요.
- **deal-risk 신호 미성숙**: 딜이 최근 생성이라 dwell 신호 약함(현재 medium 17건은 대부분 overdue). 딜이 나이 들며 분포가 벌어짐 — 억지 조정 금지.
- **크론 관찰(매일)**: 21:00 백업 자동 성공(`~/Backups/sangfor-os/*.sql.gz` 실크기), 22:30 재검증 fallback율(<30%).

## 5. 1주 후 체크포인트 (2026-07-21)
축적량 측정 → 유효화된 후속 판정 → 다음 개발 웨이브 선정:
```sql
-- 데이터 성숙도 스냅샷
select 'DomainMemory' k, count(*) from domain_memories
union all select 'gate_verdicts', count(*) filter (where color_gate_json is not null) from domain_decision_logs
union all select 'DocumentVersion', count(*) from document_versions
union all select 'open_deals', count(*) from opportunities where deal_status='OPEN'
union all select 'renewals', count(*) from renewal_opportunities
union all select 'llm_calls_real', count(*) filter (where caller is not null) from llm_calls;
```
- DomainMemory ≥ ~50 → Task1 recall 전환 측정 착수.
- gate_verdicts ≥ ~50 → Task5 캘리브레이션 착수.
- DocumentVersion 프로즈 쌍 ≥ ~30 → Task3 파인튜닝 착수.

## 부록 — 세션 완료 요약 (2026-07-12)
- **머지**: PR #128(M4 본체) · #129(M5 임베딩+recallHybrid 거버넌스 fix) · #130(M4 LLM 계측+flaky 격리) · #131(엔지니어 RAG 소비자) · #132(deal-risk). engineer-mcp PR #4(RAG 제공자 하드닝+재임베딩+위키 환류).
- 관련 메모리: [[m4-m5-decisions-2026-07-12]], [[engineer-rag-integration]], [[9router-llm-wiring]], [[local-prod-runtime]].
