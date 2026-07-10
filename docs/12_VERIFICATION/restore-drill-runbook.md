# DB 백업 복원 드릴 Runbook

목적: `~/Backups/sangfor-os/`의 pg_dump 백업이 실제로 복원 가능한지 임시 DB(`sangfor_os_drill`)에 복원해 무결성을 검증한다. 운영 DB(`sangfor_os`, :5434)는 절대 건드리지 않는다. 분기 1회 이상, 또는 백업 체계 변경 직후 실행한다.

첫 드릴 실행 기록: `.agents/results/2026-07-10-restore-drill.md` (2026-07-10, 성공)

## 전제

- `sangfor-postgres` 컨테이너 가동 중 (`docker ps | grep sangfor-postgres`)
- `packages/db/.env`에 `DATABASE_URL` 존재 (user `sangfor`)
- 모든 psql/pg_dump는 컨테이너 안에서 실행한다 — 호스트 Homebrew pg 클라이언트(v14)는 서버(v16)와 버전이 안 맞는다

## 절차

### 0. 백업 건강 확인 (드릴 전 필수)

```bash
ls -lt ~/Backups/sangfor-os/sangfor_os-*.sql.gz | head -5
```

**20바이트 파일은 빈 gzip = 실패한 백업이다.** 정상 덤프는 MB 단위. 최근 파일이 비었으면 `~/Backups/sangfor-os/backup.log`를 확인하라 — 2026-07-10 드릴에서 cron 환경의 docker PATH 부재로 7/4 이후 정기 백업 전량이 빈 파일이었던 사례가 있다. 유효 백업이 없으면 먼저 수동 백업:

```bash
bash scripts/db-backup-local.sh
```

### 1. 원본 카운트 캡처

```bash
docker exec sangfor-postgres psql -U sangfor -d sangfor_os -t -A -c \
  "SELECT 'customers', COUNT(*) FROM customers
   UNION ALL SELECT 'opportunities', COUNT(*) FROM opportunities
   UNION ALL SELECT 'mail_derived_candidates', COUNT(*) FROM mail_derived_candidates
   UNION ALL SELECT 'finance_cashflows', COUNT(*) FROM finance_cashflows
   UNION ALL SELECT 'partners', COUNT(*) FROM partners;"
```

### 2. 임시 DB 생성

```bash
docker exec sangfor-postgres psql -U sangfor -d postgres -c "CREATE DATABASE sangfor_os_drill;"
```

### 3. 복원

```bash
gunzip -c ~/Backups/sangfor-os/sangfor_os-<STAMP>.sql.gz \
  | docker exec -i sangfor-postgres psql -U sangfor -d sangfor_os_drill -q 2>/tmp/drill-restore-errors.log
echo "exit: $?" && wc -l < /tmp/drill-restore-errors.log
```

stderr 0줄 + exit 0이 정상. 에러가 있으면 `/tmp/drill-restore-errors.log`를 판독하고 드릴 실패로 기록한다.

### 4. 무결성 검증

1번 쿼리를 `-d sangfor_os_drill`로 재실행해 카운트가 원본과 전부 일치하는지 확인. 테이블 총수도 대조:

```bash
docker exec sangfor-postgres psql -U sangfor -d sangfor_os_drill -t -A -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"
```

### 5. 임시 DB 정리 (필수)

```bash
docker exec sangfor-postgres psql -U sangfor -d postgres -c "DROP DATABASE sangfor_os_drill;"
docker exec sangfor-postgres psql -U sangfor -d postgres -t -A -c \
  "SELECT COUNT(*) FROM pg_database WHERE datname='sangfor_os_drill';"   # 0이어야 함
```

### 6. 운영 무변화 확인

1번 쿼리를 원본(`sangfor_os`)에 재실행해 카운트 변화가 없음을 확인한다.

## 결과 기록

`.agents/results/YYYY-MM-DD-restore-drill.md`에 사용한 백업 파일명, 각 단계 출력, 판정(성공/실패)을 남긴다. `scripts/check-restore-counts.sh`는 앱 경유(Prisma) 카운트 재확인용 보조 수단으로 쓸 수 있다.

## 금지 사항

- 운영 `sangfor_os`에 대한 DROP/RESTORE/쓰기 — 어떤 경우에도 불가
- 임시 DB 이름은 `sangfor_os_drill` 고정 (다른 이름 사용 시 정리 누락 위험)
- 드릴 후 임시 DB를 남겨두는 것 (디스크·혼동 방지)
