# Integration Source Inventory

Date: 2026-06-26

## Purpose

This inventory fixes the target state for `sangfor-os`: complete integration of
all relevant AIOS/SANGFOR projects into one canonical repository and runtime.
Each source is classified by how it should be integrated.

## Integration Modes

| Mode | Meaning |
| --- | --- |
| Absorb | Move the useful implementation into `apps/*` or `packages/*` |
| Wrap | Keep as a service under `services/*` and call through adapters |
| Bridge | Connect through API/proxy while migration remains in progress |
| Retire later | Remove only after replacement path, evidence, and approval exist |

## Source Inventory

| Source | Primary Value | Current Evidence in Repo | Integration Mode | Current Status | Next Action |
| --- | --- | --- | --- | --- | --- |
| AIOS v1 | Existing runtime, portal behavior, registry, local automation, mail/approval workflows | `packages/proxy-core/src/aios-v1-adapter.ts`, `scripts/launch-aios-v1-stack.sh`, `scripts/start-integration-stack.mjs`, `scripts/verify-aios-features-with-mail.mjs` | Bridge then absorb selectively | Partial | Create parity checklist and bridge smoke evidence |
| AIOSv2_integration | Workflow/approval/evidence model, collaboration runtime, operating approach | `packages/business/src/approval-*`, `workflow-runner.ts`, docs/evidence patterns | Absorb | Partial | Map workflow/approval/evidence to final package milestones |
| F-aios-v3-core | Agent/runtime core and workflow execution patterns | `apps/web/src/lib/aios-v3-bridge.ts`, workflow API routes | Bridge/absorb | Partial | Confirm current bridge and decide which runtime contracts become canonical |
| sangfor-mcp-workflow | SANGFOR device workflows, RAG data, compliance/device automation, MCP server | `services/sangfor-mcp-workflow/*` | Wrap and absorb reusable workflow logic | Partial | Keep service working; expose through canonical API/adapters |
| sangfor-engineer-mcp | Product adapters, engineer automation, RAG, screenshot/evidence tooling | `services/sangfor-engineer-mcp/*` | Wrap | Partial | Use as service-backed engineer automation and knowledge source |
| AIOS-JARVIS | Voice assistant/operator interface | No canonical `apps/voice` yet | Bridge planned | Missing | Inventory source location before implementation |
| vibe-coding-os | Agent orchestration/development automation patterns | dispatch scripts and local plans only | Absorb planned | Partial/missing | Identify reusable orchestration assets before code migration |
| CFO/finance apps | Invoice, expense, VAT, subscription, cashflow, CFO dashboard | `packages/finance/*`, CFO routes under `apps/web/src/app/cfo/*` | Absorb | Partial | Connect finance to quote/commercial/renewal workflows |
| final package v3.2 | Product, DB, API, UX, security, runbook, acceptance criteria | `docs/00_EXECUTIVE` through `docs/13_COLOR_AGENT_ORG`, `docs/10_CODE_SKELETON` | Source of truth | Docs imported | Drive all gap closure from this package |

## Immediate Findings

- The repo already contains many implementation modules, but documentation did
  not previously state AIOS v1 and all source projects as the final integration
  target.
- Current UI/AI Workspace changes are not inherently wrong, but they must be
  treated as a supporting visibility layer rather than the product direction.
- The next implementation work should close gaps against final package
  milestones, not invent new navigation or automation concepts.

## Required Follow-up Evidence

- AIOS v1 bridge health and route parity smoke.
- Final package Must Have gap matrix.
- Feature parity checklist for legacy capabilities that cannot yet be absorbed.
- Verification log for typecheck/lint/test/build after each implementation
  batch.
