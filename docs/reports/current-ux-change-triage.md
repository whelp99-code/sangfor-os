# Current UX Change Triage

Date: 2026-06-26

## Purpose

The current worktree contains uncommitted UX/AI Workspace changes. These changes
are not automatically wrong, but they must not redirect the product away from
the final package and full `sangfor-os` integration goal.

## Triage

| File/Area | Classification | Reason | Required Follow-up |
| --- | --- | --- | --- |
| `apps/web/src/components/ai-workspace/*` | Defer/realign | Useful as AI activity visibility, but not the core product architecture | Keep as support panel only; remove CEO-only wording |
| `apps/web/src/components/shell/portal-shell.tsx` | Modify | Current AI Workspace navigation is not aligned with final package role-based UX | Restore role/workflow based navigation; avoid `3 pages only` concept |
| Role pages under `apps/web/src/app/(portal)/*` | Keep with review | Role pages are required by final package, but added AI panels must support actual workflows | Ensure Sales/Presales/Finance/Delivery/Support/Operator/Security remain task-capable |
| `apps/web/src/components/ui/color-review-badge.tsx` | Keep | Color Agent status badges align with V3.2 Color Agent package | Verify status names and accessibility |
| `apps/web/src/lib/ux-labels.ts` | Keep | User-facing status labels support UX/AX and Color Agent clarity | Expand only when tied to real domain statuses |
| `docs/UX-AX-STANDARDS.md` | Modify | Useful internal UX guide, but currently conflicts with final package in places | Make it subordinate to `docs/06_UX/*`; remove `3 pages only` implication |
| `.omo/plans/automation-first-redesign.md` | Defer | `3 pages only` direction conflicts with role-based final package UX | Mark as experiment, not active direction |
| `.omo/plans/ai-workspace-implementation.md` | Defer/realign | AI Workspace can support visibility but should not replace operating workflows | Reframe as optional panel |
| `.omo/plans/ux-ax-redesign.md` | Modify | Some UX principles are useful, but sidebar/menu limits must not hide required workflows | Align with final package UX |

## 2026-06-26 Alignment Update

| Area | Action Taken |
| --- | --- |
| `PortalShell` navigation | Reconnected sidebar rendering to `PORTAL_NAV` via `getVisibleNavItems()` so role/workflow pages remain visible. |
| AI command wording | Replaced CEO-specific command language with generic AI support command language. |
| UX standards | Added an explicit scope note that final package UX is authoritative and `3 pages only` is not active direction. |
| `.omo` plans | Marked automation-first redesign as deferred and AI Workspace/UX plans as subordinate to final package integration. |

## Active UX Decision

- Do not adopt `3 pages only`.
- Keep role-based dashboards.
- Keep approval queue as the human-intervention center.
- Use AI Workspace components only to show AI activity, command status, and
  evidence, not to replace the business workflow UI.
