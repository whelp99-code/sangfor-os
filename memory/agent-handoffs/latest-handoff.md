# Latest Handoff — 2026-06-28

## Summary
Built the **종축 도메인 워크플로우** end-to-end: GTM domain pipeline (marketing→sales→presales→engineer→cfo) × color-lens review, domain memory, real LLM via opencode+OpenAI OAuth, data-classification model gating, structured output, fallback chain, embedding backfill, and an apps/web dashboard.

## Where the work is
- **Branch `feat-domain-v2-complete`** (NOT `feat-domain-axis-workflow` — that ref was destroyed by shared-tree thrashing).
- Commit chain: `dddb59b`→`3228a38`→`f590ca2`→`0690f4c`→`895cfdc`→ latest (polish + worklog).
- All commits synthesized via **git plumbing** (read-tree/commit-tree) to survive concurrent agents reverting the working tree.

## Verified (evidence)
- Real LLM e2e: 5 domains produced Korean artifacts via opencode (`domain-llm-e2e.ts`).
- Structured output: CFO returned schema-valid JSON via opencode `format` (`info.structured`).
- Gating: AiModel seeded (4 models); restricted domains (engineer/cfo) routed only to gpt-5.4.
- Dashboard: `next dev` → `/api/domain-pipeline` 200 + `/domain-pipeline` page 200.
- Embedding backfill: 15 DomainMemory rows filled (hash embedder, no API key).
- ~83 unit tests across the feature.

## Detailed worklog
See `docs/13_COLOR_AGENT_ORG/Worklog_2026-06-28_Domain_Axis.md`.

## Next Recommended Actions
1. Default `runDomainPipeline` to `createDefaultDomainGenerator` (currently injected explicitly).
2. Set an embeddings API key and re-run backfill (`resolveEmbedder` will use OpenAI; currently hash fallback).
3. Map structured artifacts → real DB records (Opportunity/Quote/Invoice).
4. Quiesce the concurrent agent(s) thrashing the shared working tree, then open a PR for `feat-domain-v2-complete`.

## Risk / Known issues
- Shared working-tree thrashing: another process switches branches mid-task and reverts uncommitted tracked-file edits. Mitigation: commit via plumbing; restore tracked files from the commit SHA before running.
- apps/web prod `next build` is pre-broken (dev works) — see known-issues.
