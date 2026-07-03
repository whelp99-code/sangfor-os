# Persona Validation Report (2026-07-03)

프로덕션 빌드(`next start`) 기준, 5개 페르소나 × 26개 페이지를 실제 로그인 플로우로 브라우저 검증(Playwright CLI). 수정 → 재검증 5회 반복.

## 페르소나와 커버리지

| 페르소나 | 페이지 |
|---|---|
| 영업 (sales) | /home /customers /opportunities /deals /proposals /sales |
| CFO | /cfo/dashboard /cfo/cashflows /cfo/tax-invoices /cfo/invoices /cfo/settings /cfo/vat |
| 운영 (operator) | /modules /approvals /development /operator /registry |
| 메일 담당 (mail) | /mail-intelligence /domain-pipeline /mail-connection /knowledge |
| 일반 (general) | /dashboard /my-work /tasks /settings /api/docs |

수집 항목: HTTP status, 콘솔 에러, page error, 실패 API 요청(4xx/5xx), 빈 화면 여부.

## 반복 결과

| 회차 | 이슈 페이지 | 발견/조치 |
|---|---|---|
| 1 | 26/26 | 로그인 API가 mock 모드에서 500 (버그 #1 발견). 테스트측 레이트리밋(10/min) 회피 위해 세션 재사용으로 스펙 수정 |
| 2 | 6/26 | finance 4페이지 401, modules validate 503(프로드 fail-closed 정상동작 확인), mail 404. 테스트 서버에 실제 JWT 인증 구성 |
| 3 | 6/26 | 실제 JWT 세션인데도 401 지속 → assertApiAccess가 세션을 안 보는 root cause 확정 (버그 #2), 죽은 링크 확정 (버그 #3) |
| 4 | 4/26 | 버그 #1~#3 수정 검증 완료 (modules ✅, 죽은 링크 ✅, health/ready ✅). 잔여 finance 401은 업스트림 API 키 배선 부재로 규명 |
| 5 | **0/26** | web(3105) ↔ apps/api(3210)를 FINANCE_API_KEY로 실배선한 풀스택 구성 — 전 페르소나 클린 |

## 수정된 버그 (commit 7347b7a)

1. **`assertApiAccess`가 세션 미검증** (`apps/web/src/lib/api-auth.ts`) — 유효한 JWT 세션으로 로그인해도 finance/모듈검증 등 모든 guarded 라우트에서 401. 외곽 proxy는 세션을 검증하는데 안쪽 게이트는 bypass 플래그만 확인하던 불일치. 세션(쿠키/Bearer) 검증 수용으로 수정 + 회귀 테스트 3개 추가. 보안 posture 불변 (mock 모드/미인증은 여전히 fail-closed).
2. **mock 모드 로그인 500** (`login/route.ts`) — JWT_SECRET 미설정 시 "mock admin token 발급" 로그 후 `createSessionToken`이 FATAL throw. `verifySessionToken`이 이미 인식하는 `mock.` 토큰을 발급하도록 수정.
3. **죽은 링크** (`mail-intelligence/page.tsx`) — `/approvals/mail-candidates` 인덱스 페이지 부재([id] 상세만 존재) → `/approvals`로 교정.

## 환경 발견사항 (코드 아님 — 배포 시 필요)

- 루트 `.env`의 `JWT_SECRET=`, `AUTH_DEMO_PASSWORD=`가 **빈 값** → 실배포 전 반드시 설정 (프로드에서 mutation이 503 fail-closed 되는 원인).
- `FINANCE_API_KEY`가 web(송신)·api(검증) 어느 쪽에도 미설정 → CFO 기능 전면 401. web과 apps/api에 동일 키 설정 필요.
- 검증 시 사용한 구성: web `next start -p 3105` + api `API_PORT=3210` + 공유 `FINANCE_API_KEY` (프로세스 env로만 주입, .env 파일 무변경).

## 회귀 확인

- apps/web 전체 스위트: 130 pass / 3 skip (api-auth 신규 3개 포함)
- apps/web typecheck 0 errors

## 재사용

스윕 스펙: `/tmp/persona-sweep.spec.ts` (throwaway). 정기 사용하려면 `apps/web/e2e/`로 승격 필요 — 원하시면 승격 작업 진행.
