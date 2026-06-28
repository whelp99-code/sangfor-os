# CFO 운영 런북

> 대상: `apps/api` `/api/cfo` (단일 백엔드, `@sangfor/db` public 스키마) + `apps/web/src/app/cfo`
> 매월 반복 작업과 데이터 안전 절차를 한 곳에 정리.

## 사전 점검 (필수) — 데이터 유실 방지
재무 데이터가 두 차례 유실된 근본 원인은 **로컬 `schema.prisma`가 main과 어긋난 상태에서 `db:push`** 한 것이었다.
**스키마 변경/푸시 전 반드시 확인:**

```bash
# 1) 스키마 드리프트 확인 — finance 외 모델이 +/- 되면 중단하고 origin/main과 동기화할 것
git fetch origin
git diff origin/main -- packages/db/prisma/schema.prisma

# 2) 푸시 직전 스냅샷 (안전망)
pnpm --filter @sangfor/db cfo:snapshot
```

- `db:push`는 **드리프트가 의도한 변경(예: finance 필드 추가)만** 있을 때 실행.
- 의심되면 먼저 `git show origin/main:packages/db/prisma/schema.prisma > packages/db/prisma/schema.prisma`로 복원 후 의도한 변경만 재적용.

## 데이터 백업 / 복원

```bash
pnpm --filter @sangfor/db cfo:snapshot   # 현재 재무 데이터 → 로컬 백업(gitignore)
pnpm --filter @sangfor/db cfo:restore    # 스냅샷에서 id 기준 upsert 복원(비파괴·멱등)
```
- 데이터가 사라지면 **`cfo:restore` 한 번**으로 직전 스냅샷 상태 복구.
- 데이터를 크게 바꾼 직후에는 `cfo:snapshot`으로 백업 갱신.

### 자동 정기 스냅샷 (cron)
매시간 자동 백업 — `crontab -e`에 추가:
```cron
0 * * * * cd /Users/jmpark/Playground/sangfor-os && /usr/bin/env pnpm --filter @sangfor/db cfo:snapshot >> /tmp/cfo-snapshot.log 2>&1
```

## 스키마 변경 = 마이그레이션 (db push 아님)
스키마는 **`prisma migrate`로 정식 관리**한다(CI도 `db:migrate:deploy` 사용). 드리프트로 인한 데이터 유실을 막기 위해 로컬 `db push`는 지양하고, 부득이 쓸 경우 스냅샷을 먼저 뜨는 **`pnpm db:push:safe`**를 사용한다.

```bash
# 스키마 변경 절차
# 1) packages/db/prisma/schema.prisma 수정
pnpm --filter @sangfor/db exec prisma migrate dev --name <change>   # 마이그레이션 생성+적용
# 2) 커밋: 생성된 prisma/migrations/<...> 폴더 포함
# CI/배포: pnpm db:migrate:deploy 가 마이그레이션을 순서대로 적용
```

## 월간 마감 절차 (예시)
1. **통장 거래내역 반영**: 은행에서 거래내역 .xlsx 다운로드 → `/cfo/cashflows` 상단 "통장 거래내역 가져오기" 업로드.
   - 제목/합계행 자동 제외, 중복 자동 제외(반복 업로드 안전).
2. **프로젝트 매칭**: 업로드 시 자동 매칭. 미연결 건은 "프로젝트 자동 재매칭" 버튼 + 거래 편집의 프로젝트 드롭다운으로 보정.
3. **미수금 점검**: `/cfo/invoices` — 입금상태(미수/부분/완료)·입금일·입금액 갱신.
4. **매입/비용 점검**: `/cfo/expenses` — 납입여부·증빙 확인.
5. **대시보드 확인**: `/cfo/dashboard` — 미수금 잔액, 현금 런웨이, 월별 손익, 자금흐름 예측.
6. **백업**: `pnpm --filter @sangfor/db cfo:snapshot`.

## 마스터 데이터(프로젝트/미수금/매입) Notion 재임포트
- Notion CSV export → 폴더 지정 후:
```bash
NOTION_CSV_DIR="/path/to/개인 페이지 & 공유된 페이지" pnpm --filter @sangfor/db import:finance-csv
```
- **주의**: 이 임포터는 cashflow를 전량 삭제하므로 은행 자금흐름이 있으면 `FORCE=1` 없이는 실행 거부된다(footgun 가드). 일반 복구는 `cfo:restore` 사용.

## 서비스 기동
```bash
pnpm docker:dev                       # postgres(5434) + redis(6380)
pnpm --filter @sangfor/api dev        # /api/cfo (3200)
pnpm --filter @sangfor/web dev        # /cfo (3101)
```
- 웹 CFO 대시보드는 `apps/api(3200) /api/cfo` (public 스키마)를 읽는다. (구 NestJS 4100은 제거됨.)
