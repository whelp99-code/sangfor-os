# Plan: 사용자 중심 UI/UX/AX 전면 재설계

> Status: Realign before further implementation. This plan is subordinate to
> the final package UX documents and the complete `sangfor-os` integration
> direction. Do not remove required role/workflow pages to satisfy menu-count
> goals.

## Current Problem
- 사이드바 항목 30개 → 사용자 혼란
- 페이지당 목적이 여러 개 → 집중 불가
- Empty State 없음 → 사용자 방치
- WCAG 미준수 → 접근성 낮음
- raw 상태명 노출 → 가독성 저하
- shadcn 기본 스킨 → 개성 없음

## Target State
- 사이드바 최대 7개 항목, Role 기반 동적 변경
- One Job Per Page 원칙 적용
- 모든 Empty State에 액션 가능 메시지
- WCAG AA 준수 (대비 4.5:1, 키보드 전용 사용)
- 모든 상태명 한글 표시
- Indigo + Deep Dark 커스텀 스킨

## Steps

### Step 1: UX/AX Standards 문서 생성
- `docs/UX-AX-STANDARDS.md` 작성
- Navigation / Layout / Accessibility / Color / Typography 기준 정의

### Step 2: 디자인 시스템 전환 (shadcn → Custom)
- `globals.css` oklch → indigo/dark 팔레트로 교체
- `tailwind.config` 커스텀 토큰 정의
- Pretendard 폰트 도입

### Step 3: 사이드바 재구축
- `PortalShell` 내비게이션 30개 → 7개로 축소
- Role Switcher 상단 추가
- 숫자 배지로 Pending 건수 표시
- Role 변경 시 메뉴 동적 변경

### Step 4: 페이지 단순화
- 각 페이지에서 불필요한 섹션 제거
- 4-Plate 패턴 적용
- Empty State 추가
- 페이지당 Primary Action 1개로 제한

### Step 5: 접근성 감사
- 키보드 내비게이션 전체 검증
- 명도 대비 측정
- 스크린리더 호환성 확인
- focus 순서 최적화

### Step 6: 최종 검증
- Typecheck / Lint / Build
- 서버 기동 확인
- 실제 사용자 시나리오 테스트

## Files to Create/Modify
- `docs/UX-AX-STANDARDS.md` (NEW)
- `apps/web/src/app/globals.css` (MODIFY)
- `apps/web/src/components/shell/portal-shell.tsx` (REWRITE)
- `apps/web/src/components/shell/app-topbar.tsx` (MODIFY)
- All role pages in `apps/web/src/app/(portal)/` (MODIFY)

## Delegation
docs/UX-AX-STANDARDS.md → task(category="writing", ...)
Design system + Sidebar → task(category="visual-engineering", ...)
Page simplification → task(category="deep", per page, ...)
