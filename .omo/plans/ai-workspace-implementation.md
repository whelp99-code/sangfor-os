# Plan: AI Workspace Transformation

> Status: Realign before further implementation. AI Workspace is a support
> panel for activity, evidence, and safe commands. It must not replace
> final-package role-based workflows or hide existing operating pages.

## Goal
Transform every department page from "manual CRUD interface" to "AI workspace — see AI working, give commands when needed"

## Architecture

### New Shared Components (components/ai-workspace/)
```
ai-workspace/
├── ai-activity-feed.tsx      # 실시간 AI 활동 스트림 (WebSocket polling)
├── ai-command-bar.tsx        # CEO 명령어 입력 + 전송
├── ai-workspace-layout.tsx   # 부서 공통 레이아웃 wrapper
├── ai-status-card.tsx        # AI 처리 현황 카드 (처리량/성공/실패)
├── ai-department-state.tsx   # 부서별 AI 상태 요약
└── index.ts
```

### Each Department Page Becomes:
```
┌──────────────────────────────────────────────┐
│ ● 영업팀 — AI 자동 운영 중                   │
├──────────────────────────────────────────────┤
│ 오늘: 처리 12건 · 승인대기 2건 · 오류 0건    │
├──────┬───────────────────────────────────────┤
│      │  AI Activity (실시간)                  │
│ 현재 │  ⚡ 10:32 파이프라인 업데이트          │
│ 상태 │  ⚡ 10:28 견적 자동 생성              │
│ (요약)│  ⚡ 10:15 Color Review 통과 ✅        │
│      │  ⚡ 09:45 메일 분류 완료              │
│      │                                       │
│      ├───────────────────────────────────────┤
│      │  [AI에게 지시하기 ________________]    │
│      │  예: "견적서 다시 작성해줘"            │
│      └───────────────────────────────────────┘
└──────────────────────────────────────────────┘
```

### PortalSidebar keeps department links but simplified:
```
● 대시보드 (전체 AI 현황)
● 영업       ● 재무       ● Presales
● 구축       ● 지원       ● 보안
● 운영자     ● Color Agent
● 승인       ● 설정
```

## Implementation Steps (ordered)

### Step 1: ai-activity-feed.tsx
- Props: activities: Array<{time, icon, text, type}>
- Auto-scroll to bottom
- Real-time feel with CSS animations (slide-in)
- Group by "방금 전", "5분 전", "30분 전", "오늘"

### Step 2: ai-command-bar.tsx
- Text input + Send button
- Placeholder: "AI에게 지시하기 (예: '이 견적서 다시 작성해줘')"
- Submit calls API endpoint
- Loading state + success/error toast

### Step 3: ai-workspace-layout.tsx
- Wraps children with AI activity sidebar
- Props: title, department, children, activities, stats
- Left: page-specific content (children)
- Right: AI Activity Feed + Command Bar (fixed width 400px)

### Step 4: Update each department page
- Sales: Keep pipeline data, add AI activity feed
- Finance: Keep financial data, add AI activity feed
- All other pages: Same pattern
- Each page shows AI-relevant activity for that department

## Files to Create/Modify
- `components/ai-workspace/ai-activity-feed.tsx` (NEW)
- `components/ai-workspace/ai-command-bar.tsx` (NEW)
- `components/ai-workspace/ai-workspace-layout.tsx` (NEW)
- `components/ai-workspace/ai-status-card.tsx` (NEW)
- `components/ai-workspace/index.ts` (NEW)
- `apps/web/src/components/shell/portal-shell.tsx` (MODIFY - sidebar)
- Each `apps/web/src/app/(portal)/*/page.tsx` (MODIFY - wrap with workspace layout)

## UX Principles Applied
- 페이지 전환형: 부서 이동하면 그 부서 AI가 일하는 모습을 바로 볼 수 있음
- AI Activity Feed: Slack처럼 실시간 스트림
- CEO Command: 필요하면 직접 명령
- 자동화 가시성: AI가 일하는 모습이 보여야 신뢰감
