# ADR-008: RLS Scope Contract for Tables Without Scope Columns

- **상태**: 승인됨 (2026-08-05)
- **컨텍스트**: [U073 close_scope_rls_contracts](packages/db/prisma/migrations/20260716011300_close_scope_rls_contracts/migration.sql)
  은 190개 테이블을 스코프 카테고리로 분류하고 sangfor_app 역할에 RLS 정책을
  생성했다. `tenant_id`/`company_id`/`project_id` 컬럼이 **없는** 테이블은
  `PROJECT_ROOT` 분류로 빠지고 정책 술어가 `false`(전면 거부)로 생성되는
  구조적 결함이 있었다. 이로 인해 50개 테이블(CFO 재무 모듈 전체, orchestration·
  텔레메트리, AI 인프라)이 프로덕션에서 쓰기 불가 상태였다.

## 결정

1. **스코프 컬럼이 없는 50개 테이블은 RLS를 해제하고 거부 정책을 제거한다**
   (마이그레이션 `20260805060000_open_state_transition_logs_rls`,
   `20260805070000_open_llm_calls_rls`, `20260805080000_open_unscoped_rls_tables`).
   원본 마이그레이션이 자체적으로 면제한 9개 테이블과 동일한 패턴이다.
2. **재무 모듈의 테넌트 스코핑은 보류** — 재무 서비스 레이어(apps/api finance,
   262개 쓰기 지점)가 tenant 컨텍스트를 스레딩하지 않아, 컬럼 추가+정책 복원 시
   쓰기가 다시 차단된다. 테넌트 격리가 실제 요구될 때(멀티테넌트 고객 도입) 다음
   순서로 진행한다:
   a. internal-principal envelope의 tenantId를 finance 서비스 쓰기 경로에 스레딩
   b. finance_* 테이블에 `tenant_id`(nullable) 추가 + TENANT_ROOT 정책 생성
   c. 기존 행 백필 후 정책 활성화

## 근거

- 스코프 컬럼이 없는 테이블은 술어를 만들 수 없어 "fail-closed"가 아니라
  "전면 차단"으로 귀결된다 — 의도된 보안이 아닌 기능 상실.
- 면제 테이블은 테넌트 데이터를 담지 않는 운영 로그/텔레메트리/글로벌 레지스트리다.
  재무 데이터는 회사(company) 레벨 속성이며 현재 단일 테넌트 배포다.
- 셀프 서비스 권한(앱 역할)만 쓰기 가능하고 배포 승인 게이트가 유지되므로
  면제 상태의 실질 위험은 제한적이다.

## 결과

- deny-all 정책 0건 (검증: `pg_policies WHERE qual::text = 'false'` → 0)
- POC 생성, LLM 계측, 재무 인입, orchestration 로그가 프로덕션에서 정상 동작
- 잔여: 멀티테넌트 전환 시 위 "보류" 항목을 재개해야 한다.
