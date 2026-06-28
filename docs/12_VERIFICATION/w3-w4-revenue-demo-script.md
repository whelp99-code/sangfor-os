# W3-W4 Revenue Demo Script

## Safety

This script does not send, export, share, deploy, mutate production DBs, create release tags, or write to real upstream systems.

## Roles

- Sales: creates opportunity, quote draft, and proposal draft.
- Presales: verifies discovery and solution fit evidence.
- CFO: reviews low-margin and high-discount approval state.
- Security: confirms unsafe actions remain blocked.
- Operator: runs verification commands.

## Demo flow

1. Open `/opportunities` and create or inspect an opportunity.
2. Confirm qualification status is `qualified` before quote routing.
3. Open `/approvals` with CFO filter and confirm commercial approval items are visible.
4. Open `/proposals` and inspect a draft proposal.
5. Confirm `send`, `export`, and `share` show blocked state before approval.
6. Run the W3-W4 focused tests.
7. Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before claiming readiness.

## Acceptance

The demo passes only when unsafe customer-facing actions are visibly blocked before approval and all required commands pass.
