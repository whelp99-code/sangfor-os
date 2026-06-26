# Remaining Risks and Approval Needed

Date: 2026-06-26

## Technical Risks

| Risk | Current State | Next Action |
| --- | --- | --- |
| UX changes still broad | Role pages and AI Workspace changes remain uncommitted | Continue reviewing pages for final-package workflow alignment |
| Lint gate unavailable | `pnpm lint` fails because `eslint` is not found in workspace scripts | Decide whether to add/restore lint dependency or adjust package lint scripts |
| AIOS v1 parity unproven | Bridge and scripts exist, but smoke evidence is pending | Run mock/read-only bridge health checks |
| Foundation gaps remain | AuthContext scope, tRPC protected input scope guard, RLS code/test baseline, and centralized audit hash-chain writer are started; Next API route scope review, DB-level audit immutability, high-risk event coverage, and operational RLS application remain partial | Continue Next API route-by-route scope migration and broaden hashed audit coverage; apply RLS only after approval |
| Certification Matrix missing | Final package includes it, canonical TypeScript implementation not found | Locate source implementation or add package/API model |
| Data Export Governance partial | Skeleton/docs exist, runtime gate coverage not proven | Map export/share/print/copy paths and gate them |

## Approval Required Before Execution

| Action | Approval Required | Reason |
| --- | --- | --- |
| Operating DB migration/push | Yes | Could change persistent operational data |
| Applying RLS policies to a real PostgreSQL database | Yes | Could block reads/writes if a policy or session setting is wrong |
| Real mail send | Yes | External irreversible customer communication |
| Deployment | Yes | External system state change |
| Release tag creation | Yes | Public/release lifecycle action |
| Force push or destructive git cleanup | Yes | Could lose work or rewrite history |
| Deleting legacy source assets | Yes | May remove parity before replacement is proven |

## Safe Automatic Work

- Documentation and report updates.
- TypeScript code changes inside the workspace.
- Unit/integration tests that do not call external production services.
- Read-only local smoke checks.
- Mock upstream checks.
