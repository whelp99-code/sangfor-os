# Sangfor Partner Hub Product Design Audit

Date: 2026-06-30
Scope: `docs/superpowers/specs/mockups/00-index.html` and the current Next.js portal implementation.

## 1. Mockup Audit

The mockup set contains 16 screens grouped as core workspace, six stage tabs, CRM/channel, and shell overview. The strongest reusable patterns are:

- Left sidebar shell with slim content topbar.
- Deal record header with customer/partner chain.
- Stage path for deal progress.
- Dense list/table surfaces for repeat work.
- Right rail for AI suggestions, evidence, approvals, and next actions.

File integrity check: the index references all 16 mockup HTML files and none are missing.

## 2. App Comparison

Current app already matches the large structural direction:

- The portal uses a shared shadcn sidebar in `PortalShell`.
- Primary nav is in the left sidebar, not the topbar.
- CRM routes already exist for opportunities, customers, contacts, partners, PoC, projects, tasks, and home.

Main gaps against the mockups:

- Opportunity detail header was too plain and did not expose the partner/customer chain.
- The deal list workspace did not have the mockup-style stage path or channel summary.
- Tables showed customer and stage, but not enough partner/channel and next-action context.
- `_kit.md` still contains deprecated `.topbar` references even though page bodies use the shell pattern.

## 3. Implemented Changes

Implemented a focused first pass in the live app:

- Added `DealRecordHeader` and `DealStagePath` in `apps/web/src/components/deals/deal-record-header.tsx`.
- Updated `DealsWorkspace` to show a partner-hub summary strip, channel chain, focus deal, and stage path.
- Updated `DealsTable` to show customer/partner channel and next action.
- Updated opportunity detail page to use the mockup-style record header and stage path.
- Hardened `stageLabel()` so lower-case and upper-case stage values both resolve correctly.

This keeps the existing shadcn shell and current routes intact while moving the opportunity workflow closer to the provided mockups.

## 4. Verification

Completed:

- `git diff --check` passed for the touched files.
- Confirmed the mockup index references 16 files and no target file is missing.

Blocked:

- `pnpm --filter @sangfor/web typecheck` could not complete because pnpm started recreating `node_modules` and then registry access was blocked by sandbox/network restrictions.
- After interruption, `node_modules/.bin/tsc`, `node_modules/.bin/eslint`, and `apps/web/node_modules/.bin/next` are not present, so local typecheck/build cannot be trusted until dependencies are restored.

## 5. Three Visual Directions

Generated three Product Design directions:

1. Deal Command Workspace
   - Best for the main opportunities route.
   - Emphasizes pipeline list/table, focus deal, channel chain, and stage path.

2. Stage Execution Console
   - Best for opportunity detail and PoC/delivery workflows.
   - Emphasizes stage tabs, checklist/document workspace, AI suggestions, evidence, and approvals.

3. Channel Relationship Cockpit
   - Best for companies/contacts/partners/deal-registration routes.
   - Emphasizes customer detail, linked partner chain, active deals, contacts, and registration status.

## Next Implementation Order

1. Restore dependencies with `pnpm install`.
2. Run `pnpm --filter @sangfor/web typecheck`.
3. Run the app and visually verify `/opportunities` plus one `/opportunities/[id]` page.
4. Apply the same record header/stage rail language to PoC and project delivery surfaces.
5. Clean `_kit.md` so deprecated `.topbar` guidance no longer conflicts with the shell rule.
