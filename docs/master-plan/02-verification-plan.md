# 검증서 — 베를로 OS 품질 게이트·증거 규칙 (02)

> **For agentic workers:** 이 문서는 별도의 작업 단계가 아니라 **모든 태스크의 종료 조건**이다. 01·03~07 문서의 어떤 태스크든 "완료"를 선언하려면 이 문서의 해당 게이트를 실제로 실행하고 통과 출력을 봐야 한다. 증거 없이 완료 선언 금지 (superpowers:verification-before-completion 원칙).

---

## 1. 검증 철학

1. **증거가 주장보다 먼저다.** "통과했다"는 문장은 통과 출력을 본 뒤에만 쓴다. 실패했으면 실패 출력과 함께 실패했다고 쓴다.
2. **계기는 정직하다.** 화면·API·문서 어디에도 가짜 green(스텁을 정상으로 표기, 빈 데이터를 0으로 위장)을 만들지 않는다. 헬스는 `connected|stub`처럼 상태를 구분해 반환한다.
3. **행위 보존 작업(리팩토링)은 스냅샷이 심판이다.** Phase 0 golden/특성화 테스트가 변하면 그 리팩토링은 실패다(의도된 행위 변경은 별도 커밋 + 명시).
4. **검증 계층을 건너뛰지 않는다.** 정적 → 단위 → 통합 → 빌드 → 화면/E2E → 라이브 순. 상위 계층 통과가 하위 계층을 면제하지 않는다.

---

## 2. 게이트 매트릭스

### G1. 정적 게이트 (모든 커밋 전)
| 명령 | 기대 출력 | 비고 |
|---|---|---|
| `pnpm lint` | 전 패키지 에러 0 | web은 eslint + tsc 겸용 |
| `pnpm typecheck` | 전 패키지 에러 0 | vitest/esbuild가 못 잡는 TS2308류를 전체 tsc가 잡는다 — 생략 금지 |

### G2. 단위 테스트 (모든 커밋 전)
| 명령 | 기대 출력 |
|---|---|
| `pnpm test` | 전 패키지 passed (business 약 68 파일 기준선) |
| `pnpm --filter @sangfor/business test` | 부분 실행용 |

### G3. 통합 테스트 (DB/스키마 관련 작업 시 필수)
```bash
pnpm docker:dev                                   # postgres :5434, redis :6380
CI_INTEGRATION=1 pnpm --filter @sangfor/business test
```
- 공유 DB이므로 통합 테스트는 직렬(`vitest.config.ts fileParallelism` 설정 유지).
- 테스트 데이터는 prefix(`test-*`) + afterAll 정리 필수. 실데이터(메일 1,700+건·재무)와 섞이면 안 된다.

### G4. 빌드 게이트 (모든 PR 전)
| 명령 | 기대 출력 |
|---|---|
| `pnpm build` | 전 패키지 성공. apps/web은 `next build --webpack` prod 빌드 (2026-07-02부로 통과가 기준선 — 실패는 회귀) |

### G5. E2E / 화면 스모크 (화면 작업 시 필수)
```bash
scripts/dev-up.sh          # api :3200 + web :3101 헬스 대기까지
scripts/dev-smoke.sh       # 핵심 라우트 200/307 단언
pnpm test:e2e              # Playwright (루트 playwright.config.ts)
```
화면 변경은 **playwright-verify 스킬로 스크린샷 채증**(클린 브라우저) — 콘솔 에러 0 + 렌더 확인. 최소 채증 라우트:
`/my-work`, `/dashboard`, `/home`, `/deals`, `/deals/[실id]`, `/customers`, `/projects/[실id]`, `/inbox`, `/approvals`, `/support`, `/ai-team`, `/renewals`, `/cfo/dashboard`.

### G6. 마이그레이션 게이트 (스키마 변경 시)
```bash
git diff origin/main -- packages/db/prisma/schema.prisma   # 변경 전 필수 — stale 스키마 확인
pnpm --filter @sangfor/db db:migrate:deploy                 # 로컬 적용
npx prisma migrate status                                    # drift 없음 확인 (packages/db에서)
# fresh-DB 재현성: 새 DB에 migrate deploy만으로 스키마 완성 + schema.prisma와 empty-diff
```
- additive/nullable only. `migration.sql`을 눈으로 검토해 DROP/ALTER-narrowing이 없는지 확인. 발견 시 중단·보고.
- 실행 전 `pnpm --filter @sangfor/db cfo:snapshot`.

### G7. LLM 라이브 게이트 (도메인 AI 작업 시)
```bash
curl -s http://127.0.0.1:20128/health                       # 9router 기동 확인
# 컬러게이트 라이브: 프로젝트 허브에서 제안 생성 →
#   SELECT id, domain, "colorGateJson" IS NOT NULL AS gated FROM domain_decision_logs
#   WHERE "decisionType"='ai_proposal' ORDER BY "createdAt" DESC LIMIT 5;   → gated=t
npx tsx packages/business/scripts/verify-polish.ts          # 게이팅/대시보드/임베더 자가검증
```
- LLM 키 부재/9router 다운 시 규칙기반·stub 폴백으로 동작해야 한다(크래시 금지) — 폴백 경로도 1회 검증.

### G8. 보안 게이트 (라우트/권한 작업 시)
```bash
# 인증 없는 신규 라우트 금지: middleware 존재+커버리지 확인
ls apps/web/src/middleware.ts && grep -n "matcher" apps/web/src/middleware.ts
# 재무 접근 통제: financeAccessGuard (system_admin·finance_manager·ceo만)
grep -rn "financeAccessGuard" apps/api/src | head
# 시크릿: CI secrets-scan 잡 + 로컬 확인
git diff --cached | grep -iE "api[_-]?key|secret|password" || echo "clean"
```
- 데이터분류 게이팅 원칙: 비허용 모델 override는 조용한 다운그레이드가 아니라 **거부**여야 한다(`domain-model-policy` 테스트로 보장).

---

## 3. 데이터 정합성 SQL 체크리스트 (v1 완성·각 고도화 종료 시 실행)

`psql postgresql://sangfor:...@localhost:5434/...` (접속정보는 `.env`). 결과는 증거 파일에 그대로 붙인다.

**C-1. 진행중 딜 수치 단일화** — 아래 쿼리 결과와 홈/대시보드/딜/기회 화면·daily-report API의 수치가 전부 같아야 한다:
```sql
SELECT count(*) FROM opportunities WHERE stage = ANY(<ACTIVE_OPPORTUNITY_STAGES와 동일 배열>);
SELECT stage, count(*) FROM opportunities GROUP BY stage ORDER BY 2 DESC;  -- 분포 확인용
```

**C-2. 메일 후보 적체** — 목표: 미분류 0, pending은 승인 큐 노출분과 일치:
```sql
SELECT status, count(*) FROM mail_derived_candidates GROUP BY status;
```

**C-3. 재무-engagement 연결율**:
```sql
SELECT count(*) FILTER (WHERE "engagementId" IS NOT NULL) AS linked, count(*) AS total FROM finance_invoices;
-- expenses, tax_invoices 동일. cashflow는 FinanceProject 경유 매칭 리포트로 대체.
```

**C-4. 결정 스파인 위생**:
```sql
SELECT "decisionType", count(*) FROM domain_decision_logs GROUP BY 1;          -- ai_proposal/human_review 분포
SELECT count(*) FROM domain_decision_logs WHERE "decisionType"='ai_proposal' AND outcome IS NULL;  -- pending 큐 크기
SELECT domain, count(*) FROM domain_decision_logs GROUP BY 1;                   -- 전부 'sales' 하드코딩이면 결함(04 문서)
```

**C-5. 승격 문서**:
```sql
SELECT count(*) FROM generated_documents gd JOIN document_templates dt ON dt.id=gd."templateId"
WHERE dt."templateKey"='domain-ai';   -- 승인 수와 상응하는지
```

**C-6. demo-project 오염**:
```sql
SELECT id, name FROM projects;   -- 실프로젝트 구성 확인
```
```bash
grep -rn '"demo-project"' --include='*.ts' --include='*.tsx' apps packages | grep -v test | grep -v seed | wc -l   # 0
```

---

## 4. 릴리스 검증 체크리스트 (v1 완성 선언 시 1회 + 각 고도화 차수 종료 시)

- [ ] G1~G8 전 게이트 실행·통과 (출력 캡처).
- [ ] §3 SQL 체크 C-1~C-6 실행·기록.
- [ ] 핵심 루프 라이브 재연 (아래 시나리오를 순서대로, 각 단계 스크린샷):
  1. `/inbox`에서 메일 후보 확인 → 승인 → CRM 엔티티 생성 확인.
  2. `/deals/[id]`에서 기회 → 프로젝트 전환(POC 게이트) → `/projects/[id]` 허브 열림.
  3. 허브에서 도메인 제안 생성 → 5렌즈 verdict 칩 표시 → 승인 → 문서 링크 → `/proposals/[docId]` 열림.
  4. 같은 도메인 재제안 시 recall이 직전 결정을 반영(프롬프트에 학습 케이스 포함)하는지 로그로 확인.
  5. `/cfo/dashboard` 손익·런웨이 게이지가 실데이터로 렌더.
- [ ] 로컬 프로드 스택 재기동 검증: `./prod-local.sh` → :3100/:3210 헬스 → 위 시나리오 중 1·3 재확인.
- [ ] MCP 스택(작업이 걸쳤을 때만): `make up && make status` — 4 엔드포인트 + pg/redis + `mcp: connected`.
- [ ] 증거 종합 리포트 작성: `.agents/results/YYYY-MM-DD-release-verification.md`.

---

## 5. 증거 보관 규칙

- 위치: `.agents/results/YYYY-MM-DD-<주제>.md`. 스크린샷은 `.agents/results/shots/` (또는 리포트에 경로 기재).
- 형식: ①실행한 명령 그대로, ②출력 원문(길면 head/tail + 요지), ③판정(통과/실패/보류)과 근거, ④실패 시 재현 절차.
- PR 본문에는 증거 파일 경로를 링크한다. "테스트 통과"라는 문장만 있는 PR은 반려 대상.
- 세션 종료 시 `~/unified-db/bin/memlog write --agent claude --project sangfor-os --summary "<한 줄>" --quiet`로 저널 기록(중요 마일스톤).

---

## 6. 실패 대응 프로토콜

1. **게이트 실패 시**: 같은 명령을 그대로 재시도하지 말고 원인 먼저(systematic-debugging). 출력 전문을 읽고 최소 재현을 만든다.
2. **회귀로 보이는 실패**: 먼저 환경을 의심 — worktree `.env` 누락(`DATABASE_URL not found`), 9router 다운, postgres 미기동, node 버전. 이 4가지가 통합 테스트 실패의 최빈 원인이다.
3. **golden 스냅샷 변경**: 리팩토링 중이면 즉시 중단·원복. 의도된 행위 변경이면 스냅샷 갱신을 **별도 커밋**으로 분리하고 커밋 메시지에 무엇이 왜 바뀌는지 명시.
4. **마이그레이션 사고 징후**(테이블/데이터 소실): 즉시 중단 → `cfo:restore` → `docs/DEV_REFERENCE.md` §3.G 절차 → 사람에게 보고. 임의 복구 시도 금지.
5. **동일 태스크 2회 연속 실패(위임 시)**: opencode 위임을 중단하고 상위 모델이 직접 구현으로 전환한다.
