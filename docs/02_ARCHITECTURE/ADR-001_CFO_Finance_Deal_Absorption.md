# ADR-001 — 재무(CFO) 모듈을 딜(Deal) 스파인으로 흡수

- **상태**: Proposed (Phase 1 설계 / DB 마이그레이션 실행은 게이트 대기)
- **작성일**: 2026-06-30
- **범위**: `FinanceProject` ↔ `Engagement`/`Opportunity` 통합, 재무 데이터의 단일 출처화

---

## 1. 배경 (Context)

코드베이스에 **`project`라는 단어가 서로 무관한 3개의 모델**을 가리키고 있어, 재무 데이터가
실제 영업/납품 데이터와 단절되어 있다.

| UI 명칭 | 모델 | 테이블 | 정체 |
|---|---|---|---|
| 딜 (`/deals`) | `Opportunity` | `opportunities` | 영업 파이프라인 = 진짜 딜 |
| 구축 프로젝트 | `Engagement` | `delivery_projects` | 딜 수주 후 1:1 전환되는 실제 납품 프로젝트 |
| 재무 프로젝트 (`/cfo`) | `FinanceProject` | `finance_projects` | CSV 임포트로 생성된 **고립 엔티티** |

### 근거 (Evidence)
- `FinanceProject`(schema.prisma:1466)는 `name·client·status·날짜`만 보유하며
  **Opportunity / Customer / Engagement 어디로도 FK가 없다.**
- `Invoice·Expense·Cashflow`는 모두 `FinanceProject.projectId`에만 연결된다.
- 데이터 출처는 `packages/db/scripts/import-finance-csv.ts` (`프로젝트 → FinanceProject`).
- 그 결과 **재무 프로젝트에서 실제 딜/고객 데이터로 도달할 수 없음** — DB에 연결 고리가 없기 때문.

### 절반 놓인 다리
- `Invoice.engagementId`, `Expense.engagementId`, `TaxInvoice.engagementId` 컬럼이 **이미 존재**
  (schema:1498/1521/1594).
- 마이그레이션 이름이 `cfo_finance_and_engagement_baseline` — 원래부터 통합 의도였고
  `engagementId`가 미완성 절반.
- **Project Hub(`/projects/[id]` = Engagement 상세)는 이미 `engagementId`로 invoice/expense/
  tax-invoice를 조회**(`packages/business/src/project-hub.ts`).
- 반면 **CFO 모듈만 아직 `FinanceProject` 기준으로 조회** → 둘이 어긋남.

---

## 2. 결정 (Decision)

**재무를 `Engagement`(= 수주된 딜)에 귀속시키고 `FinanceProject`를 폐기한다 (Option A).**

SI/파트너 비즈니스에서 매출·비용은 수주(딜 win) 이후 납품 단계에서 발생하며, 그 단계의
실체가 `Engagement`이다. `Engagement`는 `Opportunity(딜)`와 1:1이므로
**"재무 → 구축 → 딜 → 고객" 단일 스파인**이 완성된다. 이미 존재하는 `engagementId` 다리와
Project Hub 조회 로직을 재사용하므로 매몰비용도 살린다.

### 검토한 대안
| | A. Engagement 앵커 (채택) | B. Opportunity 앵커 | C. FinanceProject 유지 + FK |
|---|---|---|---|
| 기존 자산 | `engagementId`·Project Hub 재사용 | 컬럼 신규 추가 | 최소 변경 |
| 딜 데이터 도달 | Engagement→Opportunity→Customer | 딜 직결 | 매핑 화면 경유(간접) |
| 수주 전 현금흐름 | 약함(전환 후 존재) | 강함 | 무관 |
| 근본 해결 | ✅ 단일 스파인 | ✅ 단일 스파인 | ❌ 이중 세계 유지 |
| 비용 | 중 | 중상 | 저 |

- **B 기각 사유**: `engagementId`가 이미 채택돼 있고, Opportunity는 납품 의미를 갖지 않아
  Engagement와 역할이 중복된다. 수주 전 입금이 중요해지면 B를 부분 도입 가능.
- **C 기각 사유**: 이중 세계를 영속화 → "실제 데이터 못 본다"는 문제를 근본 해결하지 못함.

---

## 3. 중복 데이터 점검 결과 (요청 ②)

| 대상 | 판정 | 비고 |
|---|---|---|
| `FinanceProject` ≈ `Engagement`(delivery_projects) | ✅ **진짜 중복** | 본 ADR의 흡수 대상 |
| `Subscription`(고객 라이선스) vs `FinanceSubscription`(자사 SaaS 구독비) | ⚠️ **중복 아님** | 도메인 상이(CustomerAsset+SKU vs 자사 비용). 네이밍만 혼동 유발 |
| `Project`(workspace 설정) vs `PocProject` vs `Engagement` vs `FinanceProject` | ⚠️ **명칭 과부하** | 동일 단어 `project`가 4개 모델. 흡수 후 용어 정리 권장 |

---

## 4. 단계 계획 (Phased Plan)

1. **Phase 1 — 정합(데이터)**: 기존 `FinanceProject` 행을 `Engagement`에 매핑.
   이름·client 기반 후보 매칭 + 사람이 확정하는 reconciliation 화면. 1회성 백필 스크립트.
2. **Phase 2 — 조회 전환(읽기)**: CFO 엔드포인트/`/cfo/projects`를 `FinanceProject` 그룹핑
   → `engagementId` 그룹핑으로 교체. `/cfo/projects`는 사실상 "딜별 손익"이 되고
   각 행에서 딜·고객 상세로 링크 가능.
3. **Phase 3 — 폐기**: `Cashflow.engagementId` 추가(현재 Invoice/Expense만 보유)
   → `FinanceProject`는 CSV 임포트 스테이징 테이블로 강등하거나 제거.

---

## 5. 미결 사항 (Open Decisions — 실행 게이트)

DB 마이그레이션 **실행 전 확정 필요**:

1. **앵커 선택** — `Engagement`(수주 후, 기본 채택) vs `Opportunity`(딜 전체 생애).
   수주 전 입금/선금 회계가 중요하면 B 혼합.
2. **매핑 키** — 기존 `FinanceProject`(CSV) 행을 실제 딜에 연결할 식별자
   (거래처명·딜 코드 등). Phase 1 난이도를 좌우.

---

## 6. 결과 및 리스크 (Consequences / Risks)

- **긍정**: 단일 스파인, 딜↔재무 양방향 탐색, Project Hub와 정합, 중복 모델 제거.
- **리스크 / 검증**:
  - 미전환 딜/고아 재무 → `engagementId == null` "미배정" 버킷 항상 노출.
  - 다대일 현실(1딜 N청구, 1청구 N딜) → 우선 1딜=N청구로 단순화.
  - CSV 재임포트 멱등성 → 매핑을 별도 보존.
  - 전환 전후 월별 매출·비용 합계 ±0 (백필 후 reconcile 리포트로 확인).

---

## 7. 관련 즉시 조치 (이미 반영됨)

본 ADR과 별개로, 재무 UI/API의 독립적 결함을 함께 수정:

- **`apps/api/src/routes/cfo.ts`** — `/expenses`의 `isPaid` 필터가 파라미터 부재 시 항상
  `false`로 평가돼 **납입완료 비용이 영구히 숨겨지던 버그** 수정
  (`=== undefined ? undefined : ...` 패턴).
- **`apps/web/src/components/cfo/crud-table.tsx`** — 컬럼 헤더 클릭 **정렬**(숫자/날짜/문자/
  불리언/프로젝트명) + 클라이언트 **필터** 지원 추가 → 매출·비용·현금흐름 공통 적용.
- **`apps/web/src/app/cfo/(cfo)/expenses/page.tsx`** — `납입여부: 전체 / 미납 / 납입완료`
  필터 연결 → 사라졌던 납입완료 항목을 선택적으로 조회 가능.
