# 마스터플랜 백로그 — 이월 항목 (living)

> 각 차수 실행 중 발견했으나 그 차수 범위가 아닌 것을 여기에 적어 다음 차수로 넘긴다.
> 규칙: 발견 즉시 한 줄로 기록(무엇을·어디서·왜 지금은 안 하는지). 처리되면 줄을 지우지 말고 `~~취소선~~` + (완료 커밋/차수).

## 형식
- `[출처차수] 한 줄 설명 — file:line 또는 근거 — 이월 대상 차수/사유`

## 이월 항목
- [00 작성 시] Phase 6/7 문서 간 방향 상충 — `phase-6-api-unification.md` — 1차 고도화 Task 0(ADR-002)에서 해소.
- [00 작성 시] `docs/design/DESIGN.md` 부재, 실제는 루트 `DESIGN.md` — 문서 경로 참조 시 주의.
- [00 작성 시] workflow console(3500) 컨테이너화 보류(`file:` 의존성) — 4차 고도화 Task 6에서 점검만.
- [00 작성 시] 재무 Postgres RLS 세분 통제 — 4차 고도화 Task 5에서 초안, 적용은 사람 승인 후.
- [01 WP-C, 2026-07-07] 메일 분류기 신뢰도 캘리브레이션 — 타입별 이산 상한(customer 74·partner 82·opportunity 84·poc 80·task 78)이 게이트 기준 85를 구조적으로 못 넘어 1,074건 적체 지속. `isProjectCandidateType()`(`packages/business/src/mail/classify-rules.ts:164`)가 `task|opportunity|poc`만 재검증 대상으로 삼아 **customer/partner는 AI 재검증 경로 자체가 없는 구조**(전체의 약 41%) — 임계값 조정 전에 이 경로부터 신설해야 함. 근거: `.agents/results/2026-07-07-wp-c3-pipeline.md` — 05 문서(3차 고도화)로 이월.
- [01 WP-C, 2026-07-07] `demo-project` 하드코딩 B그룹 잔여 약 76곳(주로 `packages/business`의 개별 `create*` 헬퍼·mail-candidates 경로, `candidates-update.ts`의 `projectSlug: "demo-project"` 포함) — 이번 라운드는 프론트 17곳 + 중앙해석점만 리졸버(`resolveDefaultProjectId`)로 치환. 근거: PR #100 — 06 문서(4차 고도화)로 이월.
- [01 WP-C, 2026-07-07] FinanceProject 미매핑 10건(브리지 7/17 매핑, 나머지 10건은 거래처명 자동매칭 실패·모호) — human 매핑 UI 또는 수기 매핑 절차 필요. 근거: `backfill-finance-engagement.ts` dry-run 리포트 — 담당 문서 미정, 05~06 중 착수 시점에 배정.
- [01 WP-D→최종검증, 2026-07-07] AI 커맨드 토스트가 실사용자에게 안 보임 — **근본원인 규명됨(2026-07-07 최종검증)**: z-index/stacking 문제가 아니라 shadcn `Card` 베이스 클래스의 **`overflow-hidden`**(`apps/web/src/components/ui/card.tsx:15`)이, 커맨드바 `Card` 바깥 위쪽(`absolute bottom-full`)에 렌더되는 토스트(`apps/web/src/components/ai-workspace/ai-command-bar.tsx`)를 클리핑하는 것이 원인 — DOM/opacity/z-50은 전부 정상이나 픽셀은 완전히 클리핑됨. **`fix/toast-clipping` 브랜치에서 수정 작업 진행 중**(수정 PR 출하 예정 — 토스트를 카드 밖 포털/fixed로 빼거나 overflow 예외 처리 필요). SSE 스트리밍 UI 자체의 고도화(타이핑 효과·중간 진행상황 노출 등)는 별건으로 미착수 유지. 근거: `.agents/results/2026-07-07-wp-d-live.md`, `.agents/results/2026-07-07-final-verification.md` §⑥B — 담당 문서 미정.
- [01 WP-C, 2026-07-07] bulk convert(`convertApprovedMailCandidates`, `mail-candidates-convert.ts`)는 이번 라운드에 신설된 것부터는 `createdEntityType`/`createdEntityId`를 정상 설정하지만, **과거(이 수정 이전)에 bulk 경로로 전환된 레코드는 해당 필드가 비어 있어 후보↔엔티티 역참조가 끊겨 있음**. 정리 스크립트(과거 데이터 백필) 필요. 근거: `.agents/results/2026-07-07-wp-c3-pipeline.md`의 "Defect found" 절 — 담당 문서 미정.

## 알려진 위험 (전 차수 공통 감시)
- 공유 워킹트리 thrashing: 동시 워크트리가 브랜치를 전환·되돌려 미커밋 편집 유실 → 조기 커밋으로만 방어.
- `project_id='demo'` 오염: 시드/테스트가 실DB를 오염 → 테스트 데이터 prefix + 정리 필수.
- 9router 미기동 시 LLM 경로 폴백 — 라이브 검증 전 헬스 확인.
- golden/특성화 스냅샷은 리팩토링의 심판 — 무단 변경 = 실패.
