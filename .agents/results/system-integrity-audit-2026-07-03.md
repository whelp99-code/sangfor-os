# 시스템 정합성 전수 감사 (2026-07-03)

사용자 지적("메뉴 통합 안 됨 / 데이터 일치 안 함 / project_id 기반 연결 안 됨")에 대한 데이터+코드 전수 분석. 결론: 세 지적 모두 실재. 이전 "런칭 완료" 선언은 페이지 렌더 스모크 수준이었고 정합성 미검증이었음.

## 1. 데이터가 3개의 섬으로 분리 (project_id만 같고 서로 연결 안 됨)

| 섬 | 규모 | 상태 |
|---|---|---|
| CRM 영업 | 고객 36, 영업기회 37 | 7/1 12:00 일괄 임포트(스프레드시트). **domain 0/36, 연락처 0건, owner 0/37, partner 연결 0/37** |
| 메일 인텔리전스 | 메일 1237, 고유도메인 92, 파생후보 **1261** | 후보 1261건이 전부 `proposed`(미승인): 고객473+작업396+영업기회253+파트너92. **엔티티 전환된 것 단 3건.** → partners 테이블이 빈 이유 |
| 재무(CFO) | 현금흐름 179, finance_projects 17 | 현금흐름 engagement 연결 **0/179**, finance_projects엔 CRM 연결 컬럼 자체가 없음. 외부 프록시 서비스 |

핵심: 메일에 실제 거래처 도메인 92개가 있는데 CRM 고객 36개는 domain이 비어 있어 **둘이 매칭 불가**. 메일→고객/파트너 학습 파이프라인이 1261건 방치돼 있어 두 데이터가 영원히 안 만남. 재무도 완전 별개.

## 2. project_id 기반 연결이 사실상 가짜

- DB에 프로젝트는 **1개뿐**(slug `demo-project`, 이름 아직 "Demo Project"). 그런데 상단 프로젝트 선택기는 2개(Demo Project / Ops Portal) 표시 — 둘 다 `portal-config.ts`의 `MOCK_PROJECTS` 하드코딩, 선택해도 **쿼리에 아무 영향 없음**(state만 바뀜, 영속화·네비게이션 없음).
- 비즈니스 레이어 ~30곳이 slug `"demo-project"` 문자열 하드코딩(`opportunity-center.ts:157` 등).
- **대시보드/일일리포트는 project 필터가 아예 없음** — `prisma.opportunity.findMany()` 전체 집계. 프로젝트가 2개 되는 순간 대시보드가 프로젝트를 넘나들며 새어나감.
- delivery_projects(Engagement) 9건 전부 project_id **null**(스코프 누락).

## 3. 지표 정의가 페이지마다 제각각 ("진행 중 딜"이 다 다른 숫자)

같은 "활성 영업기회" 개념인데 공유 정의가 없고 5곳에서 독립 재구현. 실제 재현:

| 화면 | 정의 | 결과 |
|---|---|---|
| 홈 "진행중 딜" | WON/LOST 제외(normalize) | 26 |
| 내 업무 "영업기회(진행 중)" | WON/LOST 제외(**raw 문자열 — 정규화 버그**) | 26(값 우연 일치, edge에서 어긋남) |
| 대시보드 executive "deals" | **필터 없음, 전 프로젝트** | 37 |
| deal_status=OPEN 기준 | — | 20 |

부수 버그: ①홈 파이프라인 깔때기의 ③결과·⑤수주·⑥딜리버리 칸은 **매핑되는 enum이 없어 항상 0**. ②executive 가중 파이프라인이 소문자 키(`lead/discovery/...`)로 조회해 enum(`LEAD/...`)과 안 맞음 → 대부분 0.1 기본값으로 떨어지는 잠복 버그.

## 4. 메뉴/IA — 라우트는 다 살아있으나(404 0건) 통합이 아니라 파편

- `/deals`(딜)와 `/opportunities`(파이프라인)는 **헤더만 다른 사실상 동일 컴포넌트**(`DealsWorkspace`) — 같은 걸 두 메뉴로 노출.
- 역할 대시보드 7개(sales/presales/delivery/support/operator/security/dashboard)는 별개 기능이 아니라 **공유 DB 위 얇은 렌즈** — `api/dashboard/[role]` 하나가 다 처리.
- "파이프라인"(영업기회) vs "도메인 파이프라인"(AI 서브시스템) 이름 충돌.
- 메일이 3개 화면(`/mail-intelligence`, `/mail-connection`, `/development/mail-candidates`)으로 분산.
- 사이드바 미연결 고아 페이지: `/mail-connection`, `/cfo/settings`, `/modules`, `/registry`.

## 우선순위 수정 로드맵

**P0 — 숫자를 믿을 수 있게 (지표 정합)**
- 공유 `isActiveDeal`/`ACTIVE_STAGES` 헬퍼 1개로 통일, 5곳 교체. 내 업무 raw-string 정규화 버그 수정.
- 대시보드/일일리포트에 project 스코프 적용(또는 다중 프로젝트 가식 제거).
- executive 가중 파이프라인 소문자 키 버그 수정.

**P1 — 프로젝트 모델 현실화 (사용자 결정 필요)**
- 단일 프로젝트로 확정: "Demo Project"→실제 이름, 가짜 Ops Portal·선택기 제거 (권장) — 또는 선택기를 진짜로 구현.
- 홈 깔때기 죽은 칸(③⑤⑥) 재매핑, delivery project_id 백필.

**P2 — 섬 연결 (project_id 기반 진짜 연결)**
- 메일 파생후보 1261건 처리 파이프라인 가동 → 고객/파트너/영업기회 실제 채우기(partners 비어있는 문제 해소).
- 고객 domain/연락처를 메일에서 백필 → CRM↔메일 매칭 가능하게.
- 재무 engagement_id 연결(더 큼, 후순위 가능).

**P3 — IA 정리**
- /deals vs /파이프라인 병합 또는 차별화, "도메인 파이프라인" 개명, 고아 페이지 연결/제거.
