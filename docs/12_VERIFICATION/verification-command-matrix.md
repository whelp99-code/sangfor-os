# Verification Command Matrix

## W1-W2 Stabilization

| Area | Command |
| --- | --- |
| Mode matrix | `pnpm --dir packages/shared exec vitest run src/modes.test.ts` |
| Readiness summary | `pnpm --dir packages/business exec vitest run src/stabilization-readiness.test.ts` |
| Mail candidate loop | `pnpm --dir packages/business exec vitest run src/mail-candidates.test.ts src/mail-candidate-connections.test.ts` |
| Health script syntax | `bash -n scripts/health-check.sh` |

## W3-W4 Revenue Core

| Area | Command |
| --- | --- |
| Quote/commercial gate | `pnpm --dir packages/business exec vitest run src/quote-engine.test.ts src/commercial-approval.test.ts` |
| Revenue queue and proposal guard | `pnpm --dir packages/business exec vitest run src/revenue-core.test.ts` |
| Opportunity qualification | `pnpm --dir packages/business exec vitest run src/deal-qualification.test.ts src/opportunity-stage.test.ts` |

## Full local gate

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Caveats

`pnpm lint` is desired but not a clean readiness signal until ESLint resolution is repaired across the workspace.
