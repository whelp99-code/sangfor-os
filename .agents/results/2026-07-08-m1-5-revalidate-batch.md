# M1-5: 재검증 데일리 배치 스크립트 정식화

## 구현

`packages/business/scripts/revalidate-batch.ts` 신규 커밋 — wp-calib 워크트리의 1회성 `calib-run.local.ts`(파일 기반 id 목록)를 일반화:
- 대상 선정: id 파일 대신 `mail_derived_candidates` DB 쿼리(`--status`로 필터, `updatedAt asc` 순, `--max`로 상한)
- `--status proposed --concurrency 2 --max <N>` 인자 지원
- `force` 미사용 — 763cd95 자가치유 캐시가 LLM-outage fallback(mode=template+fallbackReason)만 자동 재시도
- 출력: 처리/폴백/거부 카운트 콘솔 요약 + `.agents/results/kpi/revalidate-YYYYMMDD.log`에 건별 jsonl 적재, 폴백률 >30%면 경고

## 발견한 버그와 수정

최초 구현은 `process.cwd()` 기준 상대경로로 로그 경로를 잡았음 — launchd는 무인 실행이라 실행 시점 cwd가 보장되지 않는데, 실제로 `packages/db`에서 tsx를 구동해보니 로그가 `packages/db/.agents/results/kpi/`에 잘못 쓰였음(재현·확인). 이 디렉터리의 기존 관례(`replay-mail-timeline.ts`)를 따라 `import.meta.url` 기반 스크립트 자체 위치로 고정해 cwd 무관하게 항상 저장소 루트 `.agents/results/kpi/`를 가리키도록 수정, 재실행으로 수정 확인.

## 검증

`tsconfig.json`이 `src/**/*.ts`만 include해 `scripts/`는 패키지 typecheck 대상이 아님(기존 스크립트들도 동일) — 대신 실제 dev DB에 대해 두 차례 기능 드라이런으로 검증:
- 1차(수정 전 경로 버그 상태): `--status proposed --concurrency 1 --max 2` → 정상 처리, 로그 경로만 틀림.
- 2차(수정 후): 동일 실행 → `processed=2 fallback=1 (50%) rejected=0 errors=0`, 로그가 올바르게 저장소 루트에 저장됨 확인. (9router 쿼터 429로 인해 이 시점 실제 데이터 대부분은 fallback으로 처리됨 — 스크립트 자체의 결함이 아니라 §9-2와 동일한 외부 요인.)

## 스케줄 등록 — 완료 (2026-07-10, 사용자 승인)

`~/Library/LaunchAgents/`에 복사 + `launchctl load` 완료. `launchctl list | grep sangfor`로 두 잡 모두 로드 확인(`com.jmpark.sangfor.revalidate-batch`, `com.jmpark.sangfor.kpi-weekly`).

- `.agents/launchd/com.jmpark.sangfor.revalidate-batch.plist` — 매일 22:30, `--status proposed --concurrency 2 --max 300`
- `.agents/launchd/com.jmpark.sangfor.kpi-weekly.plist` — 매주 월 22:45, `scripts/kpi-weekly.sh`

## Acceptance 잔여

"3일 연속 자동 실행 성공 + 신규 proposed가 24h 내 재검증됨"은 스케줄이 실제로 며칠 돈 뒤에만 관측 가능 — 등록 3일차(2026-07-13 이후)에 `.agents/results/kpi/revalidate-*.log` 로그로 재확인 필요.
