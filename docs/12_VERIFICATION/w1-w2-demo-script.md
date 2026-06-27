# W1-W2 Role-Based Demo Script

## Roles

- Sales: approve or connect one evidence-backed mail candidate.
- Presales: inspect proposal or PoC evidence.
- CFO: inspect commercial approval gate output.
- Operator: inspect `/operator` readiness status and health runbook.
- Security: inspect `/security` unsafe actions and open readiness items.

## Demo flow

1. Start local dependencies with `pnpm docker:dev`, `pnpm db:push`, and `pnpm db:seed`.
2. Start web with `pnpm dev:web`.
3. Open `http://localhost:3101/development/mail-candidates`.
4. Confirm active internal/newsletter customer candidates are not pending approval.
5. Open an actionable candidate and approve/connect it.
6. Confirm proposal, opportunity, and customer pages show mail evidence.
7. Open `http://localhost:3101/operator` and inspect readiness checks.
8. Open `http://localhost:3101/security` and inspect unsafe action list.
9. Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before claiming readiness.

## Acceptance

The demo passes only when evidence is visible, unsafe actions are listed as gated, and verification commands pass.
