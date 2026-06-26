# Plan: Automation-First Redesign (Claw-Empire Inspired)

> Status: Deferred experiment. This plan is not the active product direction.
> `sangfor-os` must keep final-package role-based workflows and AIOS v1 parity.
> Do not implement the "3 Pages Only" or "Remove all role-based pages" sections
> unless a later approved plan explicitly supersedes the current integration
> strategy.

## Core Philosophy
"AI가 자동으로 일한다. 사람은 예외만 처리한다."

## Current Problems
- 30개 메뉴 = 사람이 모든 걸 직접 해야 하는 구조
- Sales/Presales/Finance/Delivery/Support 등 모두 수동 작업 가정
- "AI가 하고 내가 검증"이 아니라 "내가 직접 해야 함"

## Target State: 3 Pages Only

### Page 1: Executive Dashboard (Command Center)
```
AI 자동 처리 현황 (오늘)
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│ 자동처리 │ │ 승인대기 │ │ 오류  │ │ 처리량  │
│  47건   │ │   3건   │ │  1건  │ │ +12%  │
└──────┘ └──────┘ └──────┘ └──────┘

AI Activity Feed (실시간)
├─ 10:32 · 메일 분류 완료 — 신한은행 제안서 → 승인 필요
├─ 10:28 · 파이프라인 업데이트 — 현대모비스 Stage 3→4
├─ 10:15 · PoC 결과 분석 완료 — LG CNS 92% 통과율
└─ 10:02 · Color Review 통과 — 삼성SDS 기술검토 ✅

System Health (하단)
├─ Mail Intelligence  ● 정상
├─ Color Agent       ● 정상
├─ Pipeline AI       ● 정상
└─ CFO Engine        ● 정상
```

### Page 2: Approvals (Only Human Intervention)
```
승인 필요 (3건)            ← AI가 처리 못한 것만
┌─────────────────────────────────────┐
│ ■ 신한은행 제안서 — 할인율 22%      │
│   리스크: 중간  대기: 2일           │
│   [승인] [반려] [수정요청]          │
├─────────────────────────────────────┤
│ ■ 현대모비스 구축 — SOW 변경       │
│   ...                               │
└─────────────────────────────────────┘

자동 처리 내역 (최근 50건)
├─ 10:32 · 승인 완료 (자동) — KT 유지보수 계약
├─ 10:28 · 승인 완료 (자동) — 네이버 라이선스
└─ ...
```

### Page 3: System Health (AI Engine Status)
```
AI 엔진 상태
├─ Mail Intelligence  ● 정상  처리: 1,247건/일
├─ Color Agent       ● 정상  검토: 89건/일
├─ Pipeline AI       ● 정상  업데이트: 34건/일
├─ CFO Engine        ● 정상  정산: 12건/일
└─ Approval AI       ⚠ 주의  오류: 2건/시간

알림
├─ ⚠ Color Agent — Gray Review 3건 수동 검토 필요
└─ ● 모든 시스템 정상
```

## Sidebar: 3 Items

```
┌────────────────┐
│ Sangfor OS     │
├────────────────┤
│ ● 대시보드     │  ← AI 현황 + Activity Feed
│ ● 승인 (3)     │  ← 사람 개입 필요한 건수
│ ● 시스템       │  ← AI 엔진 상태
├────────────────┤
│ 설정 · 도움말  │
└────────────────┘
```

## Design Style (Claw-Empire Inspired)
- Dark theme (deep navy #0f1117)
- Accent: Cyan/Teal (AI activity indicators)
- Card style: Glass-morphism (backdrop-blur + semi-transparent)
- Real-time feed: Live activity stream (WebSocket)
- Pixel/tech aesthetic for AI agent indicators
- Minimal: Remove everything not automation-related

## Implementation Steps
1. docs/UX-AX-STANDARDS.md → Update with automation-first philosophy
2. globals.css → Dark theme + glass-morphism tokens
3. PortalShell → 3-item sidebar + Role concept removal
4. components/dashboard/command-center.tsx → New: AI Executive Dashboard
5. components/dashboard/approval-stream.tsx → New: Approval-only page
6. components/dashboard/system-health.tsx → New: AI engine status
7. Approval detail page kept (for the rare manual intervention)
8. Remove all role-based pages (sales, presales, finance, delivery, etc.)

## Validation
- [ ] 최대 3개 메뉴
- [ ] 첫 화면에서 AI 자동 처리 현황을 즉시 볼 수 있음
- [ ] 승인 페이지 = AI가 못한 것만 표시
- [ ] 시스템 페이지 = AI 엔진 상태만 표시
- [ ] 모든 수동 작업 페이지 제거
