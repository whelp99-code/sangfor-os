# WP-B (지표 정합) 독립 검증 — 2026-07-07

**판정: PASS** — 라이브 5표면의 "진행중 딜" 수치가 전부 DB 기준값 56과 일치.
검증자: 독립 검증 에이전트 (구현자 아님, 코드 수정 없음 — rebase 제외).

## Rebase

- `git fetch origin && git rebase origin/main` — 충돌 없음, 성공.
- origin/main = `a73ae10` (WP-A #96 머지 포함, dev-up.sh 버그픽스 확보).
- rebase 후 HEAD = **`5f8ed9e357a934d68e32b0d392ac0a50cd470da9`** (`fix(metrics): unify active-deal counting across 5 surfaces`), 그 아래 `16ca90d` (`feat(crm): canonical active-stage helper`).

## 독립 게이트 (구현자 주장 재검증)

| 게이트 | 결과 |
|---|---|
| `vitest run src/crm/opportunity-stage.test.ts src/role-dashboard.test.ts` | **56/56 통과** (opportunity-stage 47 + role-dashboard 9) |
| `pnpm --filter @sangfor/web typecheck` | **클린** (exit 0, 에러 0) |
| `pnpm --filter @sangfor/business typecheck` | **클린** (exit 0, 에러 0) |

vitest 출력 tail:

```
 ✓ src/role-dashboard.test.ts (9 tests) 2ms
 ✓ src/crm/opportunity-stage.test.ts (47 tests) 5ms
 Test Files  2 passed (2)
      Tests  56 passed (56)
```

typecheck 참고: 최초 실행 시 나온 에러는 전부 TS2307 `Cannot find module '@sangfor/shared'` / `'@sangfor/config'` 계열(+그로 인한 unknown 타입 캐스케이드)이었고, 신규 워크트리에 워크스페이스 패키지 빌드 산출물이 없어서 생긴 기존 클래스의 에러였음. `pnpm --filter @sangfor/shared build && pnpm --filter @sangfor/config build` 후 재실행하니 web/business 둘 다 에러 0. **이 브랜치가 유발한 신규 타입 에러 없음.**

환경 참고: 워크트리에 untracked `.env`가 없어 `packages/db/.env`, `apps/web/.env.local`을 메인 저장소에서 복사함 (알려진 워크트리 gotcha).

## 라이브 5표면 일치 (핵심 Acceptance)

DB 기준값 (읽기 전용):

```sql
SELECT count(*) FROM opportunities
WHERE stage IN ('LEAD','QUALIFIED','PROPOSAL','POC','NEGOTIATION');
-- = 56   (LEAD 30, QUALIFIED 4, PROPOSAL 16, POC 0, NEGOTIATION 6; 그 외 WON 8, LOST 3 → 총 67)
```

| # | 표면 | 수치 | 일치 | 증거 |
|---|---|---|---|---|
| a | 홈 `/home` "진행중 딜" KPI | **56** | ✅ | `wp-b-screens/home.png` |
| b | `GET /api/dashboard/executive` → `.revenuePipeline.deals` | **56** | ✅ | curl 출력 `56` |
| c | 딜 보드 `/deals` 칸반 활성 카드 (컬럼별 30+4+16+0+6) | **56** | ✅ | `wp-b-screens/deals-kanban.png`, 컬럼 라벨 `["30건","4건","16건","0건","6건"]` |
| d | 기회 목록 `/opportunities` 헤더 "진행 중 N건" | **56** | ✅ | `wp-b-screens/opportunities.png` ("진행 중 56건 · 파이프라인 4억") |
| e | `GET /api/daily-report` → `.data.entities.opportunities` | **56** | ✅ | curl 출력 `56` |

홈 깔때기: `① 제안 50 / ② PoC 0 / ④ 선정·입찰 6 / 기타 0` → 합 56. **"기타" 칸 렌더 확인** (home.png). "기타"는 미인식/미매핑 스테이지 catch-all로 계산되는 값이며(0-고정 아님), 기존의 죽은 0-고정 칸(③결과·⑤수주·⑥딜리버리)은 제거됨.

## 관찰 사항 (판정에 미포함, 수정 안 함)

`/deals` 및 `/opportunities`에 임베드된 딜 워크스페이스의 헤더가 정적 문자열 "전체 진행중 ▾ · 67건"을 표시함 — 67은 "전체" 칩(WON 8 + LOST 3 포함) 행 카운트. 활성 딜 지표가 아니라 전체-필터 행 수라서 5표면 acceptance 위반은 아니지만, 같은 화면의 "진행 중 56건" 헤더와 나란히 보여 사용자에게 모순으로 읽힐 수 있음.

- 라벨: `apps/web/src/components/deals/deals-workspace.tsx:139` (하드코딩 "전체 진행중")
- 카운트: 같은 파일 `:79-88` (`totalCount = filtered.length`, "전체" 칩이면 WON/LOST 포함)

후속 레인에서 라벨을 "전체 딜"로 바꾸거나 칩별 라벨을 동적으로 표시하는 것을 권장.

## 스크린샷

- `/Users/jmpark/Playground/sangfor-os/.agents/results/wp-b-screens/home.png`
- `/Users/jmpark/Playground/sangfor-os/.agents/results/wp-b-screens/deals.png` (테이블 뷰, 전체 칩 67건)
- `/Users/jmpark/Playground/sangfor-os/.agents/results/wp-b-screens/deals-kanban.png` (칸반, 활성 56)
- `/Users/jmpark/Playground/sangfor-os/.agents/results/wp-b-screens/opportunities.png`

## 정리

- `scripts/dev-down.sh` 실행 완료 — :3101/:3200 반납 확인 (`lsof` 무출력). postgres :5434는 공유라 유지.
- /tmp 임시 스크립트(`wpb-kanban.js`, throwaway spec, typecheck 로그) 삭제 완료.
