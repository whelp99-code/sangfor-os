# 2026-07-10 백업 복원 드릴 — 성공 (+ 정기 백업 무효 발견)

실행: peer Claude 세션(6ce29bdb), CARD-1 (.agents/coop/board.md). 절차서: `docs/12_VERIFICATION/restore-drill-runbook.md`

## 판정

- **복원 드릴: 성공.** 5개 핵심 테이블 카운트 원본과 100% 일치, 149개 테이블 복원, stderr 0줄.
- **부수 발견(중대): 정기 백업 전량 무효.** 2026-07-04 21:00 이후 cron 산출물이 전부 20바이트 빈 gzip. 원인은 cron 환경 PATH에 docker 부재(`backup.log`: `docker: command not found`, 실행 주체 main-fork `scripts/db-backup-local.sh`). 드릴은 신선한 수동 백업으로 수행. **수정은 lead 소관으로 이관** (cron 엔트리 PATH 지정 또는 스크립트 내 docker 절대경로).
- `scripts/check-restore-counts.sh`가 스테일 필터 `@ai-portal/db`로 "No projects matched" **인데 exit 0** — 조용한 허위 통과 상태였음. `@sangfor/db`로 교정 + 핵심 5테이블 추가 (이 PR).

## 증거

### 백업 건강 확인 → 수동 백업

```
-rw-r--r--@ 1 jmpark  staff       20 Jul 10 21:00 sangfor_os-20260710-210000.sql.gz   ← 빈 gzip
-rw-r--r--@ 1 jmpark  staff       20 Jul  7 21:00 sangfor_os-20260707-210001.sql.gz   ← 빈 gzip
-rw-r--r--@ 1 jmpark  staff  1495279 Jul  4 12:57 sangfor_os-20260704-125711.sql.gz   ← 마지막 유효본(수동)

$ bash scripts/db-backup-local.sh
backup written: /Users/jmpark/Backups/sangfor-os/sangfor_os-20260710-210509.sql.gz (2.2M)
```

### 원본 카운트 (sangfor_os)

```
customers|148
opportunities|90
mail_derived_candidates|1385
finance_cashflows|179
partners|3
```

### 생성 → 복원 (sangfor_os_drill)

```
CREATE DATABASE
$ gunzip -c ~/Backups/sangfor-os/sangfor_os-20260710-210509.sql.gz | docker exec -i sangfor-postgres psql -U sangfor -d sangfor_os_drill -q
restore exit: 0
stderr line count: 0
```

### 드릴 DB 카운트 — 원본과 전부 일치

```
customers|148
opportunities|90
mail_derived_candidates|1385
finance_cashflows|179
partners|3
public 테이블 총수: 149
```

### 정리 및 운영 무변화

```
DROP DATABASE
pg_database WHERE datname='sangfor_os_drill' → 0
sangfor_os 재카운트: 148|90|1385|179|3 (드릴 전과 동일)
```

### check-restore-counts.sh 교정 전/후

```
[교정 전] === DB Restore Counts Check ===
          No projects matched the filters ... (exit 0 — 허위 통과)
[교정 후 로직 실측] customers count: 148 / opportunities count: 90
          / mail_derived_candidates count: 1385 / finance_cashflows count: 179 / partners count: 3
```

## 이월 (lead 판단 대기)

1. cron 백업 PATH 수정 (main-fork 런타임 + 이 레포 스크립트 동기화) — CARD-1 SCOPE 밖이라 미수행
2. 백업 크기 하한 경보(20B 감지)를 KPI 배치 또는 backup 스크립트에 추가 검토
