# 보안 하드닝 설계문서 — 백엔드 인가(Authz)·테넌트 격리·동시성

**작성:** 2026-07-13 (실사용 QA 루프 R10~R11, grok 전수 매핑 기반) · **상태:** 설계 검토 대기(구현 전)
**입력 자료:** `.agents/coop/security-authz-map.md`(라우트 전수 표) · `.agents/coop/ux-round-10-grok.md`(발견) · 이월작업 [[m4-m5-decisions-2026-07-12]] Task5 멀티테넌시

## 0. 한 줄 요약
백엔드 인가 계층이 **체계적으로 비어 있다** — 페이지/세션 인증(AuthN)은 R9에서 봉합(airtight)됐으나, **역할 기반 접근제어(RBAC)와 프로젝트/테넌트 격리는 전 라우트에서 미구현**이다. 현재 **단일 사용자(operator 단일 role)·단일 프로젝트** 배포라 즉시 악용면은 좁지만(뷰어 로그인 자체가 없음), **멀티유저/멀티테넌시를 켜는 순간 즉시 심각**해진다. 이 문서는 이월된 멀티테넌시(Task5)와 **통합해** 인가 계층을 한 번에 세우는 설계·순서를 제안한다.

## 1. 현재 실태 (grok 전수 매핑)
- **AuthN(인증)**: R9 수정으로 페이지·API 전부 세션 게이트(비인증→/login 리다이렉트, API 401). R10-A가 12개 우회벡터로 airtight 확인. ✅
- **RBAC(역할)**: 로그인은 `operator` 단일 role만 발급(AUTH_DEMO_PASSWORD). `admin/viewer` 구분이 **로그인 플로에 존재하지 않음**. 코드에도 role 체크 거의 없음.
- **테넌트 격리**: `resolveProjectId(projectSlug ?? default)` 패턴 — 클라가 보낸 projectSlug를 무검증 신뢰. 개별 리소스 PATCH/DELETE는 UUID만 대조, 소유 프로젝트 교차검증 없음. → 멀티프로젝트 시 IDOR.
- **마스터키 승격**: web `finance` 프록시가 세션만 확인 후 `FINANCE_API_KEY`를 강제 주입 → Express `financeAccessGuard`(system_admin/finance_manager/ceo 전용)를 **우회**.
- **Express**: `/api/whelp99/tools/call`(MCP 도구=셸/파일 실행)이 서명만 확인·RBAC 없음. `/api/whelp99/tools`(GET)는 authMiddleware **이전**에 선언돼 **비인증 노출**.
- **동시성**: 메일 승인 `findFirst→create` 비원자적 → 더블클릭/경합 시 중복 엔티티 + dangling. R10에서 재현.

**결론**: 개별 "버그"가 아니라 **인가 계층 자체가 미설계**. 단건 패치로 덧대면 단일사용자 플로를 깨거나 불완전해진다 → 모델을 먼저 정해야 한다.

## 2. 정해야 할 설계 결정 (사용자/아키텍트 판단)
1. **역할 모델**: 어떤 role을 둘 것인가? 제안: `admin`(전권·설정·MCP), `operator`(업무 CRUD·승인), `finance`(CFO 도메인), `viewer`(읽기 전용). 로그인 플로가 role을 발급/저장하도록 확장 필요.
2. **테넌트 경계**: 프로젝트=테넌트인가, 조직>프로젝트 2계층인가? 세션에 `projectId`(들)을 바인딩하고 모든 쿼리를 그 스코프로 강제할지.
3. **단계적 적용 범위**: 지금 단일사용자 유지하며 "미래 대비 골격"만 세울지, 실제 멀티유저를 이번에 켤지.

## 3. 원인 (공통 뿌리)
- 비즈니스 레이어가 `projectSlug`를 **신뢰 입력**으로 받음(세션 파생이 아님).
- API 라우트가 `assertApiAccess`(세션 유무)만 부르고 **역할·소유권 가드가 없음**.
- 세션 토큰에 role은 있으나(`operator`) 이를 **강제하는 미들웨어/가드가 부재**.

## 4. 리메디에이션 웨이브 (권장 순서)
> 원칙: 세션 파생 컨텍스트로 전환(클라 입력 불신) → 공통 가드로 한 곳에서 강제 → 라우트별 role 요건 선언.

### W-S1 · 세션 컨텍스트 확립 (기반, 선행)
- 세션 토큰에 `role`·`projectIds`를 포함·검증. `getSession(req)` 서버 유틸로 role/projectScope 노출.
- **AC**: 모든 라우트가 `session.projectIds`에서 스코프를 얻고, 클라 projectSlug는 그 안일 때만 허용.

### W-S2 · 테넌트 격리 가드 (IDOR 차단)
- 공통 `assertProjectAccess(session, projectId)` — 리소스 조회/뮤테이션 전 소유 프로젝트가 세션 스코프에 있는지 대조.
- 비즈니스 함수 시그니처를 `projectSlug?` → `session-derived projectId`로 전환(list/create/patch/delete 사이트 일괄).
- **AC**: 타 프로젝트 UUID/slug로 조회·수정 시 403. (`security-authz-map.md §1`의 "취약" 행 전부 해소)

### W-S3 · RBAC 가드 (역할 강제)
- 라우트별 `requireRole([...])` 데코레이터/미들웨어. 우선순위:
  - **P0(즉시급, blocker)**: finance 프록시(`/api/finance/*`) role 체크 후 프록시 내부 403 · autopilot 토글(`/api/autopilot/config`) admin 전용 · Express MCP(`/api/whelp99/tools/call`) `mcpAccessGuard(admin)` · `/api/whelp99/tools` GET을 authMiddleware **뒤로** 이동.
  - **P1**: `/api/settings/llm`·`/api/dashboard/[role]`(role=executive 임의지정 차단)·정책 메모리.
- **AC**: 각 role별 인가/거부 매트릭스 테스트 통과.

### W-S4 · 동시성 원자화
- `customers`·`partners`에 `@@unique([projectId, name])` **마이그레이션** + `approveMailDerivedCandidate`에서 P2002 캐치→기존 반환(멱등).
- (선택) `opportunities.version` 낙관적 락 → 충돌 시 409.
- **AC**: 병렬 승인 N회 → 엔티티 1건, dangling 0. (R10-GK-03 재현 스크립트로 검증)

## 5. 즉시 조치 가능한 저위험 항목 (설계 무관, 별건 승인 시)
- `/api/whelp99/tools` GET을 authMiddleware 뒤로 이동(비인증 카탈로그 노출 제거) — 순수 순서 변경, 저위험.
- (그 외는 전부 W-S1 세션 모델 선행 필요.)

## 6. 범위 밖 / 관측
- 현재 단일사용자·단일프로젝트에서 W-S2/W-S3는 "미래 골격" — operator 단일 role이면 실질 동작 불변. 실 멀티유저 도입 시 필수.
- 마이그레이션(W-S4)은 기존 중복 데이터 선(先) dedupe 필요(제약 위반 방지).

## 7. 산출물·근거
- 전수 라우트 표·권장 코드: `.agents/coop/security-authz-map.md` (grok, R11)
- 발견 원본: `.agents/coop/ux-round-10-grok.md`
- 디자인/i18n 별도 패스: `.agents/coop/design-i18n-map.md` (agy, R11) → 별도 계획
