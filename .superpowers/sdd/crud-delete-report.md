# CRUD DELETE Report

## Entities

| Entity | Business fn | Strategy | Reason |
|--------|-------------|----------|--------|
| Opportunity | `archiveOpportunity(id)` | Hard delete (`prisma.opportunity.delete`) | No `status` field on Opportunity model |
| PocProject | `archivePocProject(id)` | Soft archive (`status = 'archived'`) | Has `status String @default("planning")` |
| Proposal (GeneratedDocument) | `archiveProposal(id)` | Soft archive (`status = 'archived'`) | Has `status String @default("draft")` |
| WorkTask | `archiveWorkTask(id)` | Hard delete (`prisma.workTask.delete`) | `status` constrained to todo/doing/waiting/done; no 'archived' value |

## Files changed

### Business package (`packages/business/src/`)
- `opportunity-center.ts` — added `archiveOpportunity`
- `poc-center.ts` — added `archivePocProject`
- `proposal-generator.ts` — added `archiveProposal`
- `task-center.ts` — added `archiveWorkTask`

All four files are already re-exported via `export *` in `index.ts` — no index changes needed.

### API routes (`apps/web/src/app/api/`)
- `opportunities/[id]/route.ts` — added DELETE handler
- `poc/[id]/route.ts` — added DELETE handler
- `proposals/[id]/route.ts` — added DELETE handler
- `tasks/[id]/route.ts` — added DELETE handler

## Typecheck
- `@sangfor/business`: 0 errors
- `@sangfor/web` (touched files): 0 errors
