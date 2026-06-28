# CFO 모듈 안정화 · 고도화 계획서

> 작성일: 2026-06-28 · 대상: `apps/api` `/api/cfo` (단일 백엔드, `@sangfor/db` public 스키마) + `apps/web/src/app/cfo`
> 목적: 1인 법인 CFO 운영을 위한 재무 모듈을 **데이터 신뢰성 → 기능 완성도 → 자동화** 순으로 안정화한다.

---

## 0. 현재 상태 요약 (As-Is)

| 영역 | 상태 |
|---|---|
| 백엔드 일원화 | ✅ 완료 — 중복 NestJS(4100) 제거, `apps/api /api/cfo` 단일화 (public 스키마) |
| 데이터 입력 | ✅ Notion CSV 임포트(프로젝트17·미수금14·매입15) + 은행 xlsx 임포트(자금흐름 179) |
| 대시보드 | ✅ 고도화 — KPI·차트(월별손익/현금예측)·미수금·프로젝트 손익 |
| 보드↔Notion 정합 | ✅ 컬럼 일치 + 프로젝트 페이지 신설 |
| 통장 연동 | ✅ 은행 명세서(xlsx/csv) 업로드 → 자금흐름(중복 제외) |
| 프로젝트 매칭 | ✅ 자동(import·재매칭) + 수동 드롭다운 (입금 위주 10/179) |
| **데이터 영속성** | ❌ **불안정 — 마스터 데이터가 2회 유실됨 (원인 미확정)** |
| 테스트 커버리지 | ⚠️ CFO 통합 테스트 사실상 없음 |
| 인증/보안 | ⚠️ 개발 우회 상태(dev bypass), 운영 키 관리 미정 |
| 스키마 완전성 | ⚠️ 프로젝트 거래처/기간, 미수금 발행일 등 누락 |

---

## P0 — 데이터 신뢰성 (최우선)

재무 데이터가 사라지면 다른 모든 작업이 무의미하므로 최우선.

### P0-1. 마스터 데이터 유실 원인 규명 ✅ (규명 완료)
- **증상**: public 스키마의 `finance_*` 데이터가 작업 중 두 차례 사라짐.
- **근본 원인 확정**: 로컬 작업트리의 `packages/db/prisma/schema.prisma`가 **origin/main과 divergent(stale)** 상태였음
  (main의 `DeliveryProject` 모델이 로컬엔 없고 옛 `Engagement`/`MeetingNote`로 되어 있었음). 이 상태에서 `pnpm db:push`를
  여러 번 실행 → Prisma가 DB를 **stale 스키마 형상으로 동기화하며 테이블 drop/rename** → 데이터 소실.
- **조치 완료**:
  - 로컬 `schema.prisma`를 origin/main과 일치하도록 복원, finance 필드(P1-1)만 정상 add.
  - 향후 `db:push` 전 **`git diff origin/main -- schema.prisma`로 드리프트 확인** 습관화(런북에 명시).
- **재발 방지(권장)**: 로컬 `db:push` 의존을 줄이고 P0-3의 마이그레이션으로 전환, push 전 `cfo:snapshot` 자동화.

### P0-2. 비파괴적 · 멱등 복원 시드 ✅ (완료)
- ~~현재 `import-finance-csv.ts`는 전체 deleteMany 후 재생성이라 자금흐름까지 날림.~~
- **구현**:
  - `pnpm cfo:snapshot` — 현재 재무 데이터(프로젝트/미수금/매입/자금흐름, id 포함)를 로컬 백업(`packages/db/.cfo-backup/`, gitignore)에 저장.
  - `pnpm cfo:restore` — 스냅샷에서 **id 기준 upsert**로 비파괴 복원(삭제 없음 → 신규 데이터 무손상, 유실분만 복구).
  - `import-finance-csv.ts`에 **footgun 가드** 추가: 은행 자금흐름 존재 시 `FORCE=1` 없으면 실행 거부.
- **검증**: 매입 15건 삭제 → `cfo:restore`로 +15 복구, 자금흐름 179건 무손상. 재실행 멱등.
- **남은 것**: 정기 자동 스냅샷(cron/주기) + 운영 백업(pg_dump)은 P0-3에서.

### P0-3. 마이그레이션 · 백업 체계 ✅ (완료)
- **마이그레이션 전환**: db-push된 현재 스키마(finance·engagement·domain 포함)를 baseline 마이그레이션으로 생성, fresh 임시 DB에서 `migrate deploy` 후 schema와 **empty-diff 검증**. 로컬은 `migrate resolve --applied`로 baseline 표기. CI test 잡을 `db:push` → **`db:migrate:deploy`** 전환.
- **자동 백업**: `db:push:safe`(스냅샷 후 push) + 런북에 시간별 cron 등록 가이드.
- **남은 것**: pg_dump 전체 백업(추후, 스냅샷으로 핵심 재무는 커버).

---

## P1 — 기능 완성도

### P1-1. 스키마 완전성 (Notion 1:1)
- `FinanceProject`: **거래처(client)·시작일·종료일** 필드 추가 (현재 name·status만 → Notion 프로젝트 DB와 격차).
- `Invoice`: **발행일(일자)** 필드 추가 (현재 입금일만 보관).
- **수용 기준**: 프로젝트/미수금 페이지가 Notion의 모든 컬럼을 손실 없이 표시.

### P1-2. 은행 임포트 정밀도
- **중복 키 강화**: 현재 (date+cashChange+거래처+적요) → 같은 날 동일금액 거래의 **오탐 스킵** 가능. 은행 **거래후잔액** 또는 **No**를 보존/활용해 진짜 유일성 확보.
- **다계좌 지원**: `FinanceAccount`와 자금흐름 연결(어느 통장의 거래인지), 계좌별 잔액 추적.
- **수용 기준**: 같은 날 동일금액 2건이 모두 정상 입력, 거래가 계좌에 귀속.

### P1-3. 프로젝트 매칭 고도화
- **규칙 메모리**: 거래처→프로젝트 매핑을 학습/저장(`PolicyMemory` 패턴)해 반복 매칭률 향상.
- **미매칭 리뷰 UI**: 미연결 자금흐름을 모아 일괄 지정하는 화면.
- 미수금/매입에도 **프로젝트 편집 드롭다운** 추가(자금흐름과 동일).
- **수용 기준**: 신규 은행 업로드 시 매칭률 상승, 미매칭 건 화면에서 일괄 처리 가능.

### P1-4. 나머지 CFO 페이지 동급 고도화 ✅ (기능 충족)
- 부가세·구독·월마감 페이지는 이미 실데이터(API)로 동작하며 레이아웃의 `force-dynamic` 적용 대상.
- **상태**: 9개 CFO 페이지 모두 실데이터 기반 동작 확인. (시각 폴리싱은 추후 선택 과제.)

---

## P2 — 운영 · 품질

### P2-1. CFO 통합 테스트 ✅ (착수 완료)
- apps/api에 vitest 추가 + `matchProjectId`/`normName` 단위 테스트(6) — CI `pnpm -r test`에서 실행(무DB).
- **남은 것**: import 중복 제거·대시보드 KPI 등 DB 의존 경로의 `CI_INTEGRATION` 통합 테스트(추후).

### P2-2. 인증/보안 운영화 ✅ (운영 경로 확정)
- `apiKeyMiddleware`: production은 키 강제, 개발은 키 미설정 시 무마찰 우회(다른 미들웨어와 일관).
- docker-compose가 api/web에 `FINANCE_API_KEY` 주입, 웹 프록시가 동일 키 전달. `.env.example`에 문서화.
- **남은 것**: 민감 재무 데이터 RLS/세분 접근통제(추후).

### P2-3. 관측성 · 런북
- `/api/cfo/health` 외 핵심 작업(임포트/마감) 로깅·지표.
- **월 마감 + 은행 업로드 + 매칭** 운영 런북 작성.
- **수용 기준**: 매월 반복 작업을 런북만으로 수행 가능.

---

## 실행 순서 (권장)

1. **P0-2 → P0-1 → P0-3** (영속성 안전장치 먼저, 그다음 원인/마이그레이션)
2. **P1-1, P1-2** (스키마·임포트 정밀도)
3. **P1-3, P1-4** (매칭·페이지 고도화)
4. **P2-1 → P2-2 → P2-3** (테스트·보안·운영)

각 항목은 독립 PR로, CI(build·test·typecheck·lint) 통과 후 머지.

---

## 이번 PR 포함분 (착수)
- 프로젝트 매칭 자동화: `importMany` 자동 매칭 + `POST /cashflows/rematch` 재매칭 + 수동 지정 드롭다운/버튼 (P1-3 일부).
- 본 계획서.
