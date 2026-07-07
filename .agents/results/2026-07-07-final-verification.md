# sangfor-os v1 Final Verification — 2026-07-07

- 기준 커밋: `origin/main` @ `22de4b5` (PR #96~#101 전부 포함 확인: a73ae10/ccf5482/0a5d291/c5cba15/8922e04/22de4b5)
- 검증 환경: 워크트리 `.worktrees/final-verify`, DB `localhost:5434/sangfor_os`, 스택 `scripts/dev-up.sh` (web :3101 / api :3200)
- 역할: 검증만 수행. 코드 수정 없음. DB 쓰기는 ⑥-A의 제품 정상 승인 플로우 1건뿐.

## DoD 판정 표

| # | 항목 | 판정 | 요지 |
|---|------|------|------|
| ① | 게이트 (lint/typecheck/test/build/integration/e2e) | **충족** | 6개 명령 전부 exit 0 |
| ② | 지표 일치 (5표면 = DB 기준값) | **충족** | 5표면 전부 **64** (DB 기준 64) |
| ③ | demo-project/MOCK 제거 (apps/web) | **충족** | web 0건·0건; packages/business 86건은 06 문서 이월 |
| ④ | "준비중" 마커 | **충족** | win-work-panel.tsx 2건만 잔존 (허용 목록 그대로) |
| ⑤ | 메일 후보 적체 | **부분충족(이월)** | proposed **1,098** 적체. 파이프라인 가동은 증명됨(converted 171). 적체 해소는 분류기 캘리브레이션(05) 선결 |
| ⑥ | 루프 라이브 재연 (A 승인→문서 / B 토스트 / C 손익) | **부분충족** | A 충족, C 충족, **B 미충족(신규 결함: 토스트가 Card `overflow-hidden`에 클리핑되어 실제로 안 보임)** |

## ① 게이트 — 명령별 exit code

| 명령 | exit | 비고 |
|------|------|------|
| `pnpm lint` | 0 | 0 errors, 47 warnings (apps/web) |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | api 63 passed/30 skipped, web 134 passed/3 skipped |
| `pnpm build` | 0 | |
| `CI_INTEGRATION=1 pnpm --filter @sangfor/business test` | 0 | 68 files, 535 passed / 1 todo |
| `PORT=3103 API_PORT=3202 pnpm test:e2e` | 0 | playwright webServer 자체 부팅 확인([WebServer] 로그), 67 passed / 34 skipped (101) |

## ② 지표 일치 — 5표면 실측 (DB 기준 64)

DB: `SELECT count(*) FROM opportunities WHERE stage IN ('LEAD','QUALIFIED','PROPOSAL','POC','NEGOTIATION')` → **64**
(스테이지 내역: LEAD 38 / QUALIFIED 4 / PROPOSAL 16 / POC 0 / NEGOTIATION 6; 그 외 WON 8, LOST 3 → 총 75. WP-B 시점 56에서 C-3 등으로 증가한 현재값 기준 판정)

| 표면 | 실측값 | 일치 | 증거 |
|------|--------|------|------|
| a. `/home` "진행중 딜" KPI | 64 | ✅ | `final-verify-screens/02-home-kpi.png` (깔때기 제안 58 + PoC 0 + 선정·입찰 6 + 기타 0 = 64) |
| b. `GET /api/dashboard/executive` `.revenuePipeline.deals` | 64 | ✅ | curl 출력 `64` |
| c. `/deals` 칸반 활성 컬럼 합 | 38+4+16+0+6 = 64 | ✅ | `final-verify-screens/02-deals-kanban.png` (리드 38 / 검증 4 / 제안 16 / PoC 0 / 협상 6) |
| d. `/opportunities` 접속 | `HTTP/1.1 307 Temporary Redirect` + `location: /deals` | ✅ | curl -sI 출력 |
| e. `GET /api/daily-report` `.data.entities.opportunities` | 64 | ✅ | curl 출력 `64` |

참고: `/deals` 테이블 뷰 헤더 "전체 · 75건"은 WON/LOST 포함 전체 행 수(64+11=75)로 활성 지표가 아님 — WP-B 평가와 동일한 정합. 스크린샷 `final-verify-screens/02-deals-count.png`.

## ③ demo-project / MOCK

- `grep -rn '"demo-project"' apps/web/src --include='*.ts' --include='*.tsx' | wc -l` → **0**
- `grep -rn "MOCK_PROJECTS" apps/web/src | wc -l` → **0**
- packages/business `"demo-project"` 잔존: **86건** → 06 문서(리팩터링 플랜) 이월 항목으로 표기

## ④ "준비중" 마커

`grep -rn "준비 중\|준비중" apps/web/src` → 2건, 전부 허용된 도메인 라벨:
- `apps/web/src/components/deals/work-panels/win-work-panel.tsx:120` ("준비중")
- `apps/web/src/components/deals/work-panels/win-work-panel.tsx:215` ("준비중 (데이터 연결 전)")

## ⑤ 메일 후보 적체

`SELECT status, count(*) FROM mail_derived_candidates GROUP BY status`:

| status | count |
|--------|-------|
| proposed | **1,098** |
| converted | 171 |
| knowledge_only | 24 |

판정: 파이프라인 가동은 증명됐으나(converted 171 누적), proposed 적체 1,098건(예상 ~1,074 대비 소폭 증가)은 미해소. 적체 해소는 분류기 캘리브레이션(마스터플랜 05) 선결 과제.

## ⑥ 루프 라이브 재연

### A. 도메인 제안 승인 → 산출물 문서 (충족)
- 대상: `/projects/cmr6cdpec00039k2ywm2ijbmq` (인카금융서비스 - Sangfor 도입), 프리세일즈 레인 pending 제안
- 흐름: pending 배지("AI 제안 · 검토대기" + 컬러 게이트 렌즈) → [승인] 클릭 → "기록됨" + brass 링크 "산출물 문서 보기 →" 노출 → `/proposals/cmrajhizz00069k8zgiprpd80` 문서 렌더("인카금융서비스 Sangfor VM PoC 제안서 개요 수정본", status approved)
- DB 반영: `domain_decision_logs.cmr9u9mn600019kdg4lg2vy4k` outcome=approved, resolved_at=2026-07-07 11:02:05; `generated_documents.cmrajhizz00069k8zgiprpd80` status=approved
- 스크린샷: `06-a1-hub-pending.png` / `06-a2-approved-brass-link.png` / `06-a3-proposal-doc.png`

### B. AI 커맨드바 토스트 가시성 (미충족 — 신규 결함)
- `/sales`에서 명령 전송 → 토스트 상태는 정상 발화(텍스트 "실행 실패: agent_run_failed" — agent 백엔드 미기동으로 정직한 실패 응답, 이 부분은 정상)
- **그러나 토스트가 뷰포트에서 실제로 보이지 않음.** DOM 증거는 전부 정상인데(box {x:1109, y:312, w:186, h:36}, `translate-y-0 opacity-100`, computed bg=near-black lab(2.75), opacity 1) **픽셀은 백색** — `document.elementFromPoint`(토스트 중심)가 토스트가 아닌 이웃 "AI 활동 로그" 카드를 반환.
- 근본 원인: shadcn `Card` 베이스 클래스의 **`overflow-hidden`** (`apps/web/src/components/ui/card.tsx:15`). 토스트는 `absolute bottom-full`로 커맨드바 Card **바깥 위쪽**에 렌더되므로(`apps/web/src/components/ai-workspace/ai-command-bar.tsx:35`) 카드 경계에서 전부 클리핑됨. z-50은 클리핑에 무력 — z-index 픽스로는 미해결.
- 스크린샷: `06-b-command-toast.png` (토스트 위치가 백지), `06-b-toast-element.png` (요소 픽셀 캡처 — 완전 백색 = 클리핑 증거)

### C. 허브 손익 — 롯데건설 리뉴얼 - 2대 (충족)
- `/projects/cmr20y0qe00249kikji7quwmm` 딜 손익: **매출 3,740,000원 / 매입 0원 / 비용 1,199,000원 / 마진 2,541,000원 (67.9%)**
- 매입 0원은 정직한 데이터 부재: `finance_tax_invoices`에 해당 engagement 연결 0건이고 롯데 관련 매입 세금계산서 자체가 DB에 0건 (연결 결함 아님). 매출(finance_invoices 2건)·비용(finance_expenses 2건)은 C-4 연결로 실값 렌더.
- 스크린샷: `06-c-lotte-pnl.png` (CFO 레인에 "매출 롯데건설 완료" 등 연결 산출물도 표시)

## 정리
- `scripts/dev-down.sh` 실행, lsof로 3101/3200/3103/3202 모두 해제 확인
- /tmp 검증 산출물(fv-* 로그, fv-specs) 삭제
- 워크트리 `.worktrees/final-verify`는 유지 (origin/main @ 22de4b5)

## 총평
게이트·지표·정리 항목(①~④)은 전부 실측 충족이며 승인→문서 루프와 허브 손익(⑥A/C)도 라이브로 재연됐다. 유일한 신규 결함은 ⑥B — AI 커맨드바 토스트가 z-50임에도 Card의 overflow-hidden에 클리핑되어 사용자에게 전혀 보이지 않으며, z-index가 아니라 클리핑 계층(토스트를 카드 밖 포털/fixed로 빼거나 overflow 예외)이 필요한 수정이다. ⑤ 메일 적체(proposed 1,098)는 설계대로 05 캘리브레이션 선결 이월 항목으로 남는다.
