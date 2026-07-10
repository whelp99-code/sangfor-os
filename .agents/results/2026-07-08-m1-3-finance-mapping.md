# M1-3: FinanceProject 미매핑 10건 human 매핑

## 매핑 결정

자동매칭기(PASS 1, `buildFpEngagementMap`)가 UNMATCHED로 남긴 10개 FinanceProject를 12개 Engagement와 대조 — 표기 차이(공사 접미사 누락, 한/영 표기, 디지털/디지탈)로 자동매칭에 실패한 3건을 확인, 인카금융그룹/게임조선은 회사 관계 확인 없이는 확정할 수 없어 null로 보류(오매핑이 정확한 값 없음보다 위험 — 잘못된 재무-고객 연결은 조용히 데이터를 오염시킴).

| FP | 결정 | 근거 |
|---|---|---|
| 부산도시가스 - hDR 기술지원 | → 부산도시가스공사 - hDR | 동일 회사, "공사" 접미사 차이로 자동매칭 실패 |
| 유니드 - 리뉴얼 | → UNID - 리뉴얼 | "유니드"=UNID 한글 표기 |
| 디지털조선 HCI Renewal | → 조선일로 JNS - 리뉴얼 (customer: 디지탈조선) | "디지털"/"디지탈" 표기 차이 |
| 인카금융그룹 | null (보류) | Incar-aSV / 인카금융서비스 두 후보 중 확정 불가 — 후속 확인 필요 |
| 게임조선 HCI Renewal | null (보류) | 조선일보 계열 여부 불확실 — 후속 확인 필요 |
| 2월 카드사용료1 | null (확정) | 프로젝트가 아닌 카드비용 항목 |
| 대통령경호처 | null (확정) | 대응 Engagement 없음 |
| 동국대학교 - aDesk | null (확정) | 대응 Engagement 없음 |
| 에스씨엘사이언스 - 서버,스위치,방화벽 | null (확정) | 대응 Engagement 없음 |
| 일지테크 - 토탈솔루션 | null (확정) | 대응 Engagement 없음 |

**주의**: AskUserQuestion으로 인카금융그룹·게임조선 확인을 요청했으나 60초 무응답 — 재무 데이터 무결성상 오매핑보다 null이 안전하다는 판단으로 보류 처리. 사용자 확인 시 재실행 필요(아래 재실행 방법 참조).

## 구현

`packages/db/scripts/backfill-finance-engagement.ts`에 `--mapping-file <path>` 모드 추가(opencode-coder 위임, diff 137줄 추가). 자동매칭이 이미 matched/ambiguous로 처리한 FP는 매핑파일이 있어도 덮어쓰지 않음. dry-run/APPLY 게이트는 기존과 동일.

## 실행 결과

- Dry-run 검증: `pnpm --filter @sangfor/db backfill:finance-engagement -- --mapping-file packages/db/scripts/fp-engagement-map.json` — 10건 전부 해소(3 matched + 7 confirmed-null), 기존 플래그 없는 실행과 100% 하위호환 확인.
- 백업: `pnpm --filter @sangfor/db cfo:snapshot` → `.cfo-backup/cfo-snapshot.json` (17 projects/15 invoices/35 expenses/179 cashflows).
- 적용: `APPLY=1` 재실행 — Cashflow +2 / Invoice +3 / Expense +3 = 8행 신규 연결.

## 연결률 전후

| | 전 | 후 |
|---|---|---|
| Cashflow | 6/179 (3.4%) | 8/179 (4.5%) |
| Invoice | 6/15 (40.0%) | 9/15 (60.0%) |
| Expense | 7/35 (20.0%) | 10/35 (28.6%) |
| **합계** | **19/229 (8.3%)** | **27/229 (11.8%)** |

## Acceptance 판정 — 실데이터상 상한 명시

목표 "연결률 ≥60%"는 **실데이터상 상한**에 막혀 미달. 구조적 원인: `projectId` FK 자체가 세 테이블에서 극소수 행에만 존재(cashflow 10/179, invoice 13/15, expense 15/35 — 스크립트 docstring에 기 기록된 사실, 이번에 DB 재확인 완료). PASS 1(bridge)의 이론적 상한은 이 38행 전부가 매핑된 FP를 가리킬 때이며, PASS 2(직접 counterparty명 매칭)는 이번 실행에서도 0건 매칭(원래부터 0 — FP 매핑과 무관한 별도 이슈). FP 레벨 매핑 자체는 완결(모호 0, 미매핑 0) — 남은 갭은 M1-3의 범위 밖인 "finance 원장에 projectId가 애초에 안 채워짐" 데이터 위생 문제로, M2 "파트너 데이터 재구축"·"converted 후보 위생" 트랙과 성격이 같아 backlog로 이관 권고.
