# UX Foundation Report — feat-ax-overhaul

## @sangfor/ui components available
packages/ui/src exports: Button, Card, Input, Modal, ToastProvider/useToast, Spinner, Badge, **Skeleton**, EmptyState, **ErrorState**, ToggleSwitch, Dropdown

## Adoption
- `Skeleton` — ADOPTED in `(portal)/loading.tsx` (variant card×3 + table×5, Korean aria-label built-in)
- `ErrorState` — ADOPTED in `(portal)/error.tsx` (passes error.message + digest details + retry=reset)
- `@sangfor/ui` added as `workspace:*` dep in apps/web/package.json (was missing)

## Files changed
| File | Action |
|------|--------|
| apps/web/src/app/layout.tsx | lang="en" → lang="ko" |
| apps/web/src/app/(portal)/loading.tsx | NEW — Skeleton-based loading state |
| apps/web/src/app/(portal)/error.tsx | NEW — ErrorState-based error boundary |
| apps/web/src/lib/status-display.ts | NEW — statusLabel(kind, value) + re-exports STATUS_LABELS |
| apps/web/src/lib/ux-labels.ts | Added LEAD/PROPOSAL/POC/WON/LOST/CLOSED + todo/in_progress/done/cancelled |
| apps/web/package.json | Added @sangfor/ui workspace:* dep |

## Typecheck result
`pnpm --filter @sangfor/web exec tsc --noEmit` → exit 0 (clean)

## Concerns
None. $→₩ substitution skipped (no $ money displays found in touched files).
