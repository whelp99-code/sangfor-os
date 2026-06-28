# CFO / 재무 모듈 작업 기록 — 2026-06-28

> 한 세션 동안 진행한 CFO(재무) 모듈 안정화·실데이터 구축·고도화 전체 기록.
> 모든 항목은 독립 PR로 CI(secrets·lint·typecheck·test·build) 통과 후 `main` 머지됨.

## 0. 한눈에 요약

| 영역 | 결과 |
|---|---|
| CI | 5개 잡 모두 동작·차단(lint 포함), test는 마이그레이션 기반(`migrate deploy`) |
| 백엔드 | CFO API 단일화: `apps/api` `/api/cfo` (`@sangfor/db` public 스키마). 중복 NestJS(4100) 제거 |
| 실데이터 | Notion CFO DB(프로젝트17·미수금14·매입15) + 하나은행 거래내역 179건, 메일 학습 1,778+건 |
| 데이터 안전 | 유실 근본원인 규명·차단 + 스냅샷/복원 안전망 + 마이그레이션 전환 |
| 기능 | 통장 CSV/xlsx 임포트(중복 제거)·프로젝트 자동매칭·대시보드 고도화·재디자인 |
| 품질 | 매칭/임포트 단위·통합 테스트, 역할 기반 접근통제, 운영 런북 |

최종 데이터: **프로젝트 17 · 미수금 14 · 매입 15 · 자금흐름 179**.

---

## 1. CI 정상화 (PR #1, #2, #3)

- **#1** W1–W4 안정화 + 리비뉴 코어 + real-mail 하드닝 베이스.
- **#2** ESLint 복구 — 바이너리·flat config 부재로 lint가 실제로 안 돌던 것을 수정:
  루트에 eslint 9 + flat config 추가, `--ext` 제거, 노이즈 규칙은 warn으로 두고 **lint를 차단(blocking)** 으로 전환.
- **#3** 대용량 메일 인제스트 시 `sqlite3` stdout 1MB 한도(ENOBUFS)를 512MB로 상향.

## 2. 메일 전체 학습 (real-mail)

- `/Users/jmpark/.mail-intel/data.db`(실메일 1,778건)를 SQLite 폴백으로 인제스트 → 지식문서/청크 생성.
- 내부도메인(blro.co.kr)·시스템 발신자 자동 억제, 외부 거래처만 후보화.
- AI 자동 활용: `context-pack-builder`가 기회/제안서 생성 시 `searchKnowledgeWithCitations`로 메일 지식을 자동 주입.

## 3. 재무 대시보드 복구 + CFO 백엔드 단일화 (PR #4, #7)

- **#4** CFO 대시보드 500/401 원인 2건 수정:
  - 웹이 호출하는 apps/api `/api/cfo`의 `apiKeyMiddleware`에 **개발 우회** 추가(다른 미들웨어와 일관).
  - **Prisma 클라이언트 충돌**: 독립 finance 패키지와 `@sangfor/db`가 같은 출력 경로 → finance generator 전용 출력 분리.
- **#7** 중복 백엔드 통합 — 미사용 `packages/finance`(NestJS, 4100, 별도 finance 스키마) 제거.
  **단일 소스**: `apps/api` `/api/cfo` (public 스키마). docker-compose의 deprecated finance 블록 정리.

## 4. Notion 재무 데이터 입력 + 검증 (PR #5, #6)

- **#5** Notion CFO CSV(프로젝트·미수금·매입·자금흐름)를 import + **원본 대조 검증**(건수·합계·행 단위).
- **#6** **날짜 off-by-one 수정** — 로컬(KST) 자정 생성→UTC 저장으로 하루 밀리던 것을 **UTC 자정**으로 교정. 빈 상태값은 null 유지. 검증 키에 날짜 포함.

## 5. 통장(은행) 연동 — CSV/xlsx 임포트 (PR #10, #11, #17)

- **#10** `POST /api/cfo/cashflows/import` — 은행 거래내역 일괄 입력, **중복 자동 제외**(date+cashChange+거래처+적요). 웹 업로드 UI(거래처/입금/출금/적요 자동 감지) + 미리보기.
- **#11** **xlsx/xls 직접 지원**(SheetJS) + **헤더행 자동 탐지**(제목행 스킵) + **합계행 제외**. 하나은행 `거래내역조회*.xlsx` 검증.
- **#17** **`balanceAfter`(거래후잔액)** 추가 → 같은 날 동일금액 거래도 구분하는 정밀 중복 키.
- 실제 입력: 하나은행 2개 파일(2025-11 ~ 2026-06) 합쳐 **179건**, 은행 합계와 정확히 일치. 수기 중복분 정리.

## 6. 프로젝트 매칭 (PR #13, #17)

- 거래처명 정규화(`(주)`·`주식회사`·공백 제거) 후 **입금→미수금 거래처 / 출금→매입처**로 프로젝트 해석, 다중 매칭은 금액으로 특정.
- **import 시 자동 매칭** + `POST /api/cfo/cashflows/rematch`(미연결만) + 미수금/매입/자금흐름 **프로젝트 드롭다운**.

## 7. 데이터 신뢰성 (P0) — 핵심 (PR #14, #16, #25)

- **유실 근본원인 규명(#16)**: 로컬 `schema.prisma`가 origin/main과 어긋난(stale) 상태에서 `pnpm db:push`를 반복 → DB가 stale 형상으로 동기화되며 테이블 drop/rename → **재무 데이터 유실**. 재발 방지(푸시 전 `git diff origin/main -- schema.prisma` 확인) 명문화.
- **비파괴 스냅샷/복원(#14)**: `cfo:snapshot`(전체 백업) / `cfo:restore`(id 기준 upsert, 삭제 없음·멱등). `import-finance-csv.ts`에 footgun 가드(은행 자금흐름 존재 시 FORCE=1 없이 거부).
- **마이그레이션 정식 전환(#25)**: db-push된 스키마 갭을 baseline 마이그레이션으로 생성, fresh DB에서 `migrate deploy` → schema와 empty-diff 검증. CI test를 `db:push` → **`db:migrate:deploy`** 전환. `db:push:safe`(스냅샷 후 push) + 시간별 cron 가이드.

## 8. 스키마 완전성 (PR #15)

- `FinanceProject`에 **거래처·시작일·종료일**, `Invoice`에 **발행일** 추가(무손실) + 기존행 백필 + UI/임포터 반영 → Notion 컬럼과 일치.

## 9. 품질·보안·운영 (PR #18, #19, #20, #22, #24, #28)

- **#18/#22** 매칭 단위 테스트(apps/api vitest) + DB 의존 경로(import 중복·매칭·KPI) `CI_INTEGRATION` 통합 테스트.
- **#24** `financeAccessGuard` — `/api/cfo`를 재무 권한(system_admin·finance_manager·ceo)만 허용.
- **#19** `FINANCE_API_KEY` 문서화(prod 강제/dev 우회/웹 프록시 전달).
- **#20** 부가세·구독·월마감 페이지 카드 스타일 정비.
- **#28** CFO를 `PortalShell`로 감싸 **왼쪽 사이드바 흡수**(별도 레이아웃→포털 통일 틀).

## 10. 디자인 — 플러그인 + 재디자인 (PR #31)

- 공식 마켓플레이스(`anthropics/claude-plugins-public`) 추가 → **figma·frontend-design** 등 설치, figma MCP 연동.
- **#31** CFO 대시보드 재디자인 — "잉크 위 장부(ledger)" 방향(frontend-design):
  - 토큰(`lib/cfo-theme`): ink/paper/hairline + 입금 teal·출금 brick·강조 brass (AI 기본값 회피)
  - 시그니처: **현금 런웨이 게이지**(0–12개월, 3개월 위험선) + **등폭 tabular ₩** 장부 타이포
  - hairline 장부형 KPI 스트립 + 장부 행 테이블 + 차트 재색.

---

## 핵심 명령 (운영)

```bash
# 서비스
pnpm docker:dev                          # postgres(5434)+redis(6380)
pnpm --filter @sangfor/api dev           # /api/cfo (3200)
pnpm --filter @sangfor/web dev           # /cfo (3101)

# 데이터 백업/복원
pnpm --filter @sangfor/db cfo:snapshot   # 로컬 백업(gitignore)
pnpm --filter @sangfor/db cfo:restore    # 비파괴 복원

# 은행 거래내역 가져오기: /cfo/cashflows 상단 업로드(.xlsx/.csv)
# 스키마 변경: prisma migrate dev (db push 지양; 부득이하면 db:push:safe)
```

관련 문서: [`cfo-stabilization-and-enhancement-plan.md`](./cfo-stabilization-and-enhancement-plan.md) · [`../12_VERIFICATION/cfo-runbook.md`](../12_VERIFICATION/cfo-runbook.md)

## 남은 후속(선택)
- Figma 스펙 화면(대시보드 프레임)과 정밀 1:1 대조(무료 플랜 호출 한도 리셋 후).
- ledger 테마를 나머지 CFO 페이지·포털 전체로 확장.
- `prisma migrate` 자동 정기 스냅샷(cron) 운영 적용, pg_dump 전체 백업.
- 재무 데이터 Postgres RLS(비소유 롤+테넌트 컨텍스트) 세분 통제.

## 참고: 동시 진행된 다른 트랙(타 작업, main 반영됨)
MCP 서비스 부트업/드리프트 제어(#21·#26·#29), 영업기회→Engagement 전환(#23·#27), 웹 LLM 키 관리(#30·#32). 본 문서 범위(CFO/재무) 밖.
