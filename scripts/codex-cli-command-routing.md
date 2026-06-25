# Codex CLI Command Routing

## Purpose

This note records the command paths that are available from this workspace when Codex needs to hand work off to `opencode`, run the Cursor Agent, or open the repo in `cursor`.

## Available Commands

| Target            | Command                                               | Notes                                                                                                         |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| opencode agent    | `opencode run "<prompt>"`                             | Non-interactive agent execution. Uses the current workspace unless a different cwd is provided by the caller. |
| opencode session  | `opencode --continue` / `opencode --session <id>`     | Resume the latest or a specific session.                                                                      |
| opencode status   | `opencode session` / `opencode stats`                 | Inspect session state and usage.                                                                              |
| Cursor Agent      | `agent --print --trust --workspace <path> "<prompt>"` | Run the installed Cursor Agent against a workspace.                                                           |
| cursor launcher   | `cursor <path>`                                       | Open a file or directory in the editor.                                                                       |
| cursor goto       | `cursor -g <file:line[:character]>`                   | Jump to a specific location.                                                                                  |
| cursor new window | `cursor -n <path>`                                    | Open the workspace in a new window.                                                                           |

## What Is Not Available

- This workspace does not expose a `cursor agent` command.
- `cursor` is the editor launcher CLI here, not a code-generation agent interface.
- If a workflow needs code generation, the implementation path is `opencode run ...` or `agent --print --trust --workspace <path> "<prompt>"`.

## Repo Hooks

| Script                                        | File                                              |
| --------------------------------------------- | ------------------------------------------------- |
| `pnpm collaboration:run`                      | `scripts/run-collaboration-contract.ts`           |
| `pnpm collaboration:continue`                 | `scripts/continue-collaboration-queue.ts`         |
| `pnpm collaboration:dispatch-cursor-agent`    | `scripts/dispatch-cursor-agent.ts`                |
| `pnpm collaboration:dispatch-opencode`        | `scripts/dispatch-opencode-phase5.ts`             |
| `pnpm collaboration:dispatch-opencode-phase6` | `scripts/dispatch-opencode-phase6.ts`             |
| `pnpm collaboration:dispatch-opencode-fix`    | `scripts/dispatch-opencode-fix-directive.ts`      |
| `pnpm collaboration:dispatch-opencode-phase7` | `scripts/dispatch-opencode-phase7-remediation.ts` |

## Environment Variables

- `OPENCODE_COMMAND`: overrides the command used for opencode dispatch.
- `CURSOR_AGENT_COMMAND`: overrides the Cursor Agent binary; the default is `agent`.

## Operational Rule

- Use `opencode` or `agent` for code generation and bulk implementation.
- Use `cursor` only as a launcher/editor unless a real agent CLI is added later.
- Use Codex for verification, review, and command routing documentation.
