# Canonical Design Ledger — Sangfor OS System Refactor

This append-only ledger preserves terminal design-lane decisions before the final Prometheus plan is scaffolded. Full task cards remain in the agent results; this file records the scheduling-critical contract.

## design_schema_sequence — terminal

- One `DB-OWNER` exclusively owns `packages/db/prisma/schema.prisma`, formal migrations, seed, `packages/db/src/rls.ts`, schema backfills, and generated Prisma boundary.
- Required additive order: scope bridge expand → reviewed/idempotent scope backfill → validate/composite constraints → auth dual-write/RLS pilot → canonical workflow/artifact/approval core → governance backfill/validation → audit hardening → commercial/support/people expansion → domain backfill/validation → retention/AI/export expansion → scheduler persistence → expanded RLS coverage/contract tightening.
- Existing models should be reused. New canonical models are required for versioned workflow/run and generic artifact/version; existing command-simulation workflow models and generated documents are bridged, not renamed/deleted in the first release.
- Scratch databases use a task/short-SHA prefix, deploy all formal migrations, assert empty schema diff, capture before/after/orphan/cross-scope counts, prove second backfill run changes zero rows, and drop only task-owned databases.
- Rollback is forward-only for migrations: revert app routing/flags, retain additive rows/tables, never edit applied migration SQL, and use restore only with explicit approval after verified data corruption.
- Shared-file serialization owners are also required for auth/session, approval/artifact, audit, scheduler, deals UI, dashboards, package manifests/lockfile, and the business barrel.

## design_m6_workflow — terminal

- Canonical owner is root PostgreSQL + `packages/business` + `apps/web`. `packages/agent` and `services/sangfor-mcp-workflow` become stateless execution adapters and never own definitions, approvals, or run history.
- Existing root `Workflow`/`WorkflowStep` are developer-command simulation records; `WorkflowTemplate` is a placeholder; web/agent/service Map stores are not backfill sources.
- M6 requires canonical `WorkflowDefinition`, `WorkflowRun`, `WorkflowRunStep`, `WorkflowRunArtifact`, and append-only `WorkflowRunEvent` with immutable definition version/hash snapshot, one ACTIVE version per scope/key, scoped idempotency, optimistic/row locking, RLS, audit, and AuthContext-only actors.
- Prerequisites are the W1 scope/RLS/RBAC/audit foundation plus canonical Artifact/ArtifactVersion and version-pinned Approval contracts. W2 immutable Quote and Commercial Approval are required before the commercial workflow gate can turn green.
- Deal order is qualification → registration → discovery → sizing → solution-fit → quote simulation → commercial. Current qualification code reverses discovery/solution-fit dependencies and must be corrected.
- API rejects body scope/actor/approvedBy, requires permissions/idempotency/expectedVersion, and exposes stable 400/401/403/404/409/422 contracts. UI shows active definitions as immutable, creates new versions, shows persisted blockers/events, and survives restart.
- Duplicate Map/client-approval workflow routes are characterized, then deprecated/removed only after the canonical API/UI and MCP adapter converge. Existing command simulation remains explicitly namespaced.

## Cross-lane discoveries pending terminal cards

- M7/M8: approval currently uses reason-string lookup and direct pending→approved updates; proposal version changes do not stale approval/release; some AI promotion paths default to approved. Canonical release input is `{action, artifactVersionId, approvalId}` and must verify exact current immutable versions.
- S1/S3/S8: Product/SKU, sizing, compatibility, discount and vendor request skeletons exist, but DemoLicense, runtime vendor flows, approval detail/diff UI, and safe approval state transitions are missing.
- S7: canonical requirement ID drift exists across older reports. `docs/01_SPEC/Requirements_MoSCoW.md` remains source of truth. There is no generic Artifact model; export/access skeletons lack scope/FKs. Retention/legal hold must wait for M1/M7/M8 and M4/M5.
- Performance: current canonical queries are unbounded and required Artifact/M6 models are absent. Performance acceptance must be scratch-only with an owned Postgres 16 lifecycle, sentinel safeguards, numeric targets, bounded query/index checks, browser DOM limits, and teardown receipts.

## design_m7_m8 — terminal

- `GeneratedDocument.status` is not release authority. Only the current immutable `DocumentVersion.id` plus an exact version-pinned approval can authorize release.
- Approval moves through machine validation to `ready_for_human_approval`; only that state accepts human approval. `auto_failed`, rejected, stale, or superseded versions cannot be approved. Actor/scope/role come only from AuthContext.
- Add immutable version hashes/classification/origin/current pointer, exact quote/artifact FKs, append-only decision rows, validation/policy snapshots, stale metadata, unique pending requests, transaction-safe quorum, and audit/outbox.
- Save uses expected-current CAS and no automatic conflict retry. New versions invalidate release authority. Historical decision rows remain immutable and visible even when current validity is stale.
- W2 release contract is `{action, artifactVersionId, approvalId}`; server resolves the linked exact quote/commercial approval and current-version/hash. Runtime reason/title lookup is removed.
- Current Playwright config has no named `chromium` project; final commands must not use `--project=chromium` unless the plan first creates such a project.

## design_m10_qualification — terminal

- Reuse the one-to-one `DealQualification`; do not add a parallel score/history model. Add Technical Fit, scoring version, revision, assessor/time and range/revision constraints.
- Canonical `bant-tf-v1` is integer 0–100: B20/A20/N24/T16/Technical20, pass at 60. Existing rows are `bant-v0` and remain Discovery-blocked until reassessed.
- Server owns derived score/pass fields. Create/update is transactional with optimistic revision, contact ownership validation, redacted snapshot audit, and rollback on audit failure.
- Opportunity creation starts at LEAD; direct/advance transition to QUALIFIED and M6 Discovery start both require a current passing assessment. M6 snapshots the exact revision without overloading workflow-definition snapshot.
- Existing deal detail already loads qualification but hides it behind hard-coded dashes; add one atomic editor/read-only card and conflict-preserving 409 behavior.

## design_s9_restore — terminal

- Canonical S9 is `FULL_DATABASE_LOGICAL_RESTORE_SUPPORTED_IN_ISOLATED_DRILL`; `TENANT_SCOPED_RESTORE_NOT_IMPLEMENTED` until M1 ownership closure exists.
- Implement a fixture-only Postgres 16 isolated source/target harness that never reads repo `.env`, current `DATABASE_URL`, existing compose container, or named volumes. Validate per-table counts/hashes, schema hash, sequences, migration idempotency, RPO/RTO and cleanup.
- Add failure injection, explicit receipt exit codes, label-based stale cleanup, backup manifest/inventory/sequence sidecars, direct-restore script refusal, weekly fixture CI and quarterly manually approved real-artifact drill.
- Provisional objectives are 25-hour RPO and 15-minute RTO until three real-artifact drills are ratified. No production restore/import is part of automated QA.

## design_s6_people — terminal

- Extend `EngineerCertification`; add certification definition/evidence, engineer skill, eligibility policy, engagement capability requirements and per-requirement engineer assignment. Auth permissions, skills, credentials and assignments remain separate concepts.
- Eligibility requires active same-company membership, sufficient skill, issuer-controlled verified evidence, unrevoked/unexpired certification where required, and exact product-family/capability. No admin/force fallback.
- Revocation blocks active assignments transactionally; expiry is synchronously re-evaluated at protected actions and by durable revalidation, never auto-restored.
- Existing project engineer lane and delivery dashboard are the UI owners. MCP product/RAG DB is not the people/certification source of truth.

## design_v31_auth_ai — terminal

- V3.1 acceptance adds three primary cards: canonical 3-part HS256 JWT with fixed algorithm/issuer/audience/jti; DB-backed principal/role lifecycle plus privileged MFA; and two-distinct-approver high-risk role change.
- Roles are resolved from active DB membership, not token/body alone. Disabled users and inactive/expired roles fail closed; privileged roles require canonical MFA evidence.
- Self CEO grant, requester/target approval, duplicate approver, expiry, concurrency and cross-company role changes are rejected. Role-change decisions reuse the M7 approval kernel.
- M16 must explicitly fail empty results and exact 84/94/1/79 thresholds; source coverage affects eligibility and missing service cost becomes a deterministic risk flag supplied by the quote contract.

## design_s10_roi — terminal

- Canonical surface is `/dashboard/roi`; `/dashboard` shows only a summary/link, `/home` and `/cfo` do not duplicate ROI logic.
- First release does not invent ROI money/ratio: verified ROI stays `UNKNOWN` until approved baselines, incremental benefit attribution, cost coverage and matching metric definition versions exist.
- Metric states are `MEASURED`, `PARTIAL`, `UNKNOWN`, `COLLECTING`, `SOURCE_UNAVAILABLE`; measured zero and unknown must differ in API/UI.
- Add metric registry, versioned approved benchmarks, daily snapshots, AI execution/provider-attempt lineage, bounded scoped DB aggregates and provenance. Never sum opportunity/asset/subscription/renewal duplicates or LLM estimates/invoices twice.
- W2 provides lifecycle facts, W6 durable instrumentation/materialization, M16 reviewed AI verdict, and W4 the IA slot. Scope/auth foundation is a hard gate.

## design_s7_governance — terminal

- S7 is blocked until canonical M1 scope, RLS, append-only audit, M7 approval and M8 Artifact/Version exist. Do not create proposal-specific shadow governance.
- Add versioned retention policy/assignment, legal hold/scope, retention run/items, exact-version export request and one-use user-bound HMAC capability, append-only access event, ownership transfer/items and missing owner/member lifecycle fields.
- Restricted view uses a visible watermark and records view/copy attempts; copy prevention is best-effort UX, not DRM. Export starts with dependency-free JSON and has no share/send/mail/MCP side effect.
- Legal hold blocks purge in domain logic and DB; retention is preview→approval→revalidation→manual capped purge. Artifact envelope/hash/audit/evidence remain after content purge.
- Ownership transfer must move all open artifact/opportunity/approval/renewal/support ownership to an active same-company successor before role revocation, all-or-nothing.

## design_m9_m17_m18 — terminal

- M9 core Customer/Opportunity exists; remaining work is canonical route regression, BusinessRole/assignment authorization, stable cursor pagination and large-fixture proof. `/opportunities*` stays compatibility redirect; `/customers` and `/deals` are canonical.
- M17 landing is a 10-BusinessRole map. `/` redirects from verified BusinessRole, nav/direct route/dashboard API share permission metadata, body/query project scope is untrusted, and unavailable telemetry is not displayed as zero/green.
- M18 requires executable synthetic drills for stuck approval, missing RLS context and AI cost spike: metric→alert→supported remediation→audit/evidence→recovery→cleanup. No raw DB update, RLS disable, live provider or external Slack is allowed.
- Large fixture is scratch-only: 100 customers, 1,000 opportunities, 10,000 artifacts and canonical role users, with stable bounded payload/count validation.

## design_full_coverage — terminal REJECT baseline

- Canonical coverage is 28 requirements plus 71 acceptance rows = 99/99, assigned to 23 primary owner cards with zero unowned rows, zero multiple-primary rows and zero cycles after `APR-01` precedes `WF-01`.
- The repository remains REJECT until canonical ID drift, scope split, auth stacks, unshipped RLS, audit concurrency, approval/MCP bypass, duplicate quote/lifecycle/workflow/AI models and acceptance ambiguity are fixed.
- Freeze `Requirements_MoSCoW.md` as the ID registry; name cards with ID plus title. Relabel conflicting historical specs and update FastAPI-era contracts to the actual Next/Express/TypeScript architecture.
- Primary DAG: docs contract → auth/principal → RBAC/ABAC → scope/RLS → audit → approval kernel → workflow/artifact → CRM/qualification/catalog/quote → vendor/delivery/support/people → AI/governance → UX/ops/ROI → performance → release.
- Deterministic corrections: opaque foreign resource ID returns 404, explicit foreign scope returns 403; one acceptance superset includes subscription; performance gets numeric p95 budgets; DoD is command/evidence based.

## design_s1_s3_s8 — terminal

- S1 reuses DiscountRequest/VendorRequest and adds DemoLicense. Special-discount/demo creation is one serializable idempotent transaction with exact version approval, events/audit and no external vendor send; raw license keys are never stored.
- S3 reuses SizingTemplate/CompatibilityRule and stores immutable typed rule payloads as ArtifactVersions. Drafts do not affect active evaluation; publishing requires exact approved version and deterministic non-executable operators.
- S8 uses a server-computed, allowlisted exact-version diff. Quote adapters compare stable lines/decimals, document text is escaped, unknown JSON is metadata-only, stale/cross-scope/corrupt chains fail closed and remove decision controls.
- Resolve the cross-lane approval wording as: decision history remains immutable; current validity is separately stale. A plan must not erase a historical approval or allow it to release a superseding version.

## design_performance — terminal

- Add only `perf:contracts` and runner-owned `perf:smoke`. The latter rejects caller DB URLs/remote Docker, creates a labelled digest-pinned loopback Postgres 16 container, sentinel-checks exact DB/application/run, migrates without ordinary seed, strips external credentials and proves cleanup.
- Deterministic corpus: 100 customers, 1,000 opportunities, 10,000 ArtifactVersions, one catalog/quote set and one side-effect-free active M6 workflow; archived and foreign-scope sentinels must never leak.
- Default targets: quote kernel p95 5ms/p99 10ms; quote HTTP p95 300ms/p99 500ms; list DB/API p95 50/250ms; dashboard p95 300ms and ≤256KiB; ten workflow starts ≤2s/p95 500ms; browser ready ≤2.5s/page ≤750ms. Hosted timing records five baselines before becoming blocking.
- Keyset order is `updated_at DESC,id DESC`, first defaults 50/max 100, aggregates are DB-side, mounted record nodes ≤50 with no hidden responsive duplicate. Dedicated production Playwright config uses workers 1/retries 0/no reused server.

## design_s2_s4_s5 — terminal

- S4 uses immutable minute-based policy versions and case SLA clock/timer snapshots. Initial reversible 24x7 elapsed defaults: critical 60/240, high 240/1440, medium 1440/2880, low 1440/4320 response/resolution minutes.
- S2 creates SupportCase-linked VendorEscalation and VendorRequest atomically, idempotently and without network submission; manual submission evidence/reference changes the paired state.
- S5 RCA is a canonical M16 Artifact/Version workflow: quality gate → Support Lead review → Solution Architect review → internal approval. Critical resolution, SLA breach or vendor escalation requires RCA before close; customer send remains false.
- Support work requires M6 snapshots, asset-safe M14 lookup, M16 and signed BusinessRole/audit. No support-local shadow workflow/quality/auth model.

## design_m16_ai_quality — terminal

- Canonical `AiQualityEnvelopeV1` covers exact ArtifactVersion, evidence/source/citation coverage, missing/known gaps, confidence basis, injection/leakage risks, prompt/model/evaluation provenance, required human reviews, blockers and derived eligibility.
- `qualityPassed` means ready for review, not approved. `customerSendAllowed` is recomputed from current version/hash, latest assessment, approved prompt/model/tool releases, required human reviews and Artifact approval; it never means autonomous sending.
- Add runtime assessment/evidence/review and release evaluation/prompt/model snapshot models; keep existing `AiQualityResult` as case-result data. Missing evaluators, empty corpora, injection, leakage, cross-scope evidence and stale versions fail closed.
- Proposal/quote/RCA/domain AI adapters share one policy service. AI never recalculates quote money, color gate is not human review, optional Langfuse receives IDs/metrics only and cannot change the decision.

## Final synthesis decisions before Metis

- Canonical primary owner IDs are exactly: `DOC-01`, `SEC-01`, `SEC-02`, `DB-01`, `AUD-01`, `APR-01`, `ART-01`, `WF-01`, `CRM-01`, `QUAL-01`, `CAT-01`, `QTE-01`, `VND-01`, `DLV-01`, `SUP-01`, `PPL-01`, `AIQ-01`, `GOV-01`, `UX-01`, `OPS-01`, `ROI-01`, `PERF-01`, `REL-01`. Test aliases must not become additional primary owners.
- Canonical card order splits cycles: `SEC-02a` before approval and `SEC-02b` role-change after; `ART-01a` identity/schema before approval FKs and `ART-01b` compatibility/release after audited approval; workflow runtime begins only after audited approval and artifact contracts.
- M1 classification freezes the current 150-model baseline: 13 explicit global shared, 1 tenant root, 32 company roots, 44 project roots, 60 non-null child-FK closures. U017–U042, U068 and U072 may add models, and each migration must register every added model in exactly one scope class. Final U073 validates `baseline 150 + planned additions = current Prisma model count`, with zero unclassified, ambiguous, optional-only or stale entries. Child models do not receive redundant scope columns.
- Required security containment precedes feature rollout: fail-open login/bypass, direct restore, unauthenticated MCP bridges/mutating tools, caller-supplied approval identity, GitHub-before-approval and live finance/device send paths are disabled or fail-closed until their canonical kernels pass.
- Release authority is one exact-version kernel for irreversible/external actions. Human actor/scope survives the finance proxy, MCP is a stateless execution adapter, action/target/version/hash/nonce/idempotency/receipt are bound, and ambiguous external sends are never blindly retried.
- M7 historical `ApprovalDecision` remains append-only. Current exact-version/hash/policy/quorum validity is separate derived/materialized state. New content invalidates current release authority without rewriting historical decisions.
- M16 `qualityPassed` means ready for human review. Just-in-time customer eligibility requires current ArtifactVersion, complete assessment, approved prompt/model/tool release, required M7 decisions, commercial approval and permission; no autonomous send route is added.
- UI uses existing hubs: `/deals`, `/approvals/[id]`, `/registry/products|rules`, `/support/[id]|policies`, `/delivery/people`, `/projects/[id]`, `/security`, `/operator/workflows`, `/dashboard/roi`, `/settings/archive`. New top-level detached apps are forbidden.
- Minimality wins within full M+S coverage: reuse current models/routes, merge support S2/S4/S5, compact S6 into delivery staffing, keep S10 thin and evidence-honest, freeze CFO/MCP expansion, and implement no C/W features. All ten Should requirements still receive implementation and evidence because the user requested complete plan execution.
- S9 remains the canonical tenant restore drill. `S9a` is the isolated full-database logical restore prerequisite; `S9b` is a fixture-only tenant-selective export/import/remap/hash/idempotence drill after M1 ownership closure. Neither authorizes production restore.
- Acceptance harness freezes 28 requirement IDs + 71 acceptance IDs and exactly one owner/test per row. Strict PASS rejects skip/fixme/todo/only/retry/zero-test/fake-green output; UNKNOWN blocks release. Dedicated Playwright acceptance/performance configs use no retries/reuse and no nonexistent project flag.
- External staging deployment, real credentials, production migrations/backfills/RLS activation, purge, restore, real send/share/device mutation and break-glass remain explicit manual approval gates. Local code/config/disabled-state and scratch/staging-equivalent rehearsal can complete without falsely marking external state PASS.
- Execution baseline is `origin/main@081a1c0c708104f7d0dd50667a261ea84e9ce85c`; `PLAN-PUBLISH` creates `codex/system-refactor-w0-w6` at `/Users/jmpark/Playground/sangfor-os-w0-w6` only from fully absent state, or strictly validates and reuses the exact registered recovery pair at baseline with a clean worktree and absent snapshot destination. Any partial/path/branch/HEAD/cleanliness/destination mismatch fails closed without removal or overwrite. Root owns only `.omo` control plane; SCM, implementation, tests, QA and review are delegated.

## Durable registry validation — terminal

- `.omo/drafts/sangfor-os-system-refactor-units.md` contains exactly U001–U076 with 242 valid dependency edges, no duplicate/missing IDs, no self-reference, no cycle, and exactly the 23 canonical primary owners.
- `.omo/drafts/sangfor-os-system-refactor-traceability.md` contains exactly 99 unique IDs: 28 requirements plus 71 acceptance rows. Every row has one allowed primary owner, one allowed primary test alias, valid unit references and one evidence-state contract.
- Verification modes are normalized to `AUTONOMOUS_LOCAL`, `MANUAL_EXTERNAL_PENDING`, or `MANUAL_EXTERNAL_PASS`; current matrix has 98 local rows and one pending external row (`AC-DOD-09`).
- `U002` is the first non-documentation security-containment unit, `U009` is S9a, `U074` is S9b and depends on U009, and `U076` is the final 99-row/release reconciliation unit.

## Metis collision corrections — terminal

- `packages/business/src/index.ts` has an explicit global `BIZ-BARREL` single-writer lease. All 28 units that may register business exports queue only the barrel-edit substep behind that lease; parallel work outside the barrel remains allowed.
- Git worktree creation, index, staging and commits have a global `SCM` single-writer lease. Unit implementation and QA workers never stage or commit. A dedicated delegated SCM owner rechecks the exact changed-file allowlist and fresh pre-commit implementation review, stages only those paths, creates the atomic commit, and records its SHA receipt. That receipt closes ordinary units; U007/U030/U076 close only after their committed-SHA authoritative acceptance and a subsequent different fresh independent verifier PASS. U007/U030 dependents cannot start sooner, U076 post-commit acceptance starts Final Verification, and final-SHA U007/U030 reruns are release revalidation only.
- `REQ-M18` traceability excludes connector unit `U070`; its autonomous evidence closes through `U067,U068,U069,U071`. Connector live-smoke remains separately mixed/manual and cannot contaminate local M18 PASS.

## Resource-recovery semantic corrections — terminal

- The canonical local execution vocabulary is exactly `AUTONOMOUS_LOCAL`; `MANUAL_EXTERNAL_PENDING` is reserved for AC-DOD-09. A credential-ready connector protocol is local work, while credentialed live smoke remains manual/external and cannot be represented as local PASS.
- Clean-worktree execution is part of every card contract. Before the U003 wrapper exists, U002 invokes root/engineer with Node 20 and workflow with Node 22 explicitly. From U003 forward, every workspace command routes through `scripts/run-workspace-runtime.sh`. Consumers build dependency packages in DAG order before tests.
- U007 owns both API production ESM build/start repair and the canonical acceptance resource-lease contract. `RESOURCE_LEASE_FILE` binds run ID, owner unit, leased web/API ports and expiry; mismatched or expired receipts fail before a server starts.
- Legacy auth expansion is fail-closed: existing User/UserCompanyRole rows begin nullable or `legacy_pending`/inactive, local seed principals are explicitly active, and real activation/backfill/tightening remains reviewed work rather than a permissive default.
- U021 extends the existing AuditLog only. Each row has required tenant and scope level, DB-consistent optional company/project scope, canonical inventory registration, fail-closed backfill before tightening, and advisory-lock serialization keyed by canonical scope. No audit-head model or temporary parallel scope classifier is allowed.
- Transferable current ownership is represented only by mutable same-company `ownerAssignmentId -> UserCompanyRole.id` on Artifact, ApprovalRequest, Opportunity, WorkTask, VendorRequest, RenewalOpportunity and SupportCase. Creator/requester/decision history never changes during ownership transfer.
- U018 owns `validationSnapshotHash`; U019 owns WorkflowDefinition CAS revision and all six immutable WorkflowRun activation snapshot fields including `activationApprovedAt`. U024 extends the existing RoleChangeRequest only and contributes to, but does not duplicate ownership of, AC-V31-AUTH-06.
- U035/U047 freeze and persist a typed, hashed per-line fulfillment snapshot containing term, license metric, deployment and fulfillment facts. U051 projects only this snapshot, blocks unresolved required vendor workflows and removes every direct CustomerAsset creation bypass.
- U058 capability transport is canonical and unambiguous: first issuance returns the secret only in the response body; every later consumption uses `Authorization: Capability <secret>` with the stable export ID. Request body, query, cookie, and path transport are rejected; only the digest is stored and responses return `Cache-Control: no-store`. Any historical receipt retaining alternate transport wording is explicitly superseded by this contract.
- U060 creates `/operator/workflows` and its test; `/operator` is redirect/summary-only. U063 reuses U060's sole ten-role map and route-responsibility registry.
- U072 must define exact scoped metric/benchmark/snapshot/execution lineage. Legacy LlmCall/CostEvent rows without deterministic scope are quarantined and excluded from canonical ROI; new writes require scoped AiExecution lineage. U073 still requires zero unclassified, ambiguous, optional-only or stale planned entries.
- U076 runs the tracked 23-test-alias execution map on the exact final candidate SHA, generates new receipts for all 98 autonomous rows, creates and runs `tests/e2e/playwright/release-acceptance.spec.ts` only through U007, and aggregates U066's existing U007-based viewport receipt. T-REL directly owns only REL rows.
- U067/U069 and every later DB/browser unit use U009 task-owned scratch lifecycle, U007 leases and cleanup receipts. U070–U076 use an explicit sanitized environment, disable implicit repo `.env*` loading and external egress, and never fall back to caller/repository databases or credentials.

## Superseding registry validation after semantic corrections — terminal

- The earlier 242-edge receipt is historical and superseded. After adding the governed-release, scratch-lifecycle, ROI-drill and final-acceptance dependencies, the authoritative registry contains exactly 76 unique units and 259 dependency edges, with zero invalid references, zero self-references and zero cycles.
- The 23 canonical primary owners remain unchanged. The traceability matrix still contains 99 unique rows and 23 exact primary test aliases; AC-BIZ-04 now closes through U048 commercial approval plus U055 governed internal-release evidence.
- Registry dispatch leases now include `BIZ-BARREL` for U061–U063 because those cards may touch the shared business barrel, while every acceptance card must present the U007 resource lease receipt and matching unit owner before a server starts.

## Gate12 mechanical registry correction — terminal

- The earlier 259-edge receipt remains historical and is superseded. The confirmed current execution registry contains exactly 76 unique units and 272 valid dependency edges, with zero invalid references, zero self-references, and zero cycles.

## Gate14 authoritative registry and model-owner correction — terminal

- The prior 272-edge receipt is historical and superseded. Current snapshot evidence (`.omo/drafts/sangfor-os-system-refactor-units.md` and `.omo/drafts/ulw-recovery-notepad-20260717.md`) establishes the authoritative registry as exactly 76 unique units, 273 dependency edges, 0 invalid references, 0 self references, and 0 cycles.
- The planned Prisma model-addition owner set is corrected to include U011 and U014 alongside the already frozen model-owning units U017–U042, U068, and U072. The exact early progression is frozen as `150→151 (U011)→152 (U014)→154 (U017)→156 (U018)→161 (U019/U020)`.
- The already frozen final model progression remains authoritative: `150 + 48 = 198`, with `U040=173 → U041=179 → U042=189 → U068=192 → U072=198`; no alternate denominator or dynamic model count is permitted.
- This Gate14 entry is the latest terminal ledger state and supersedes contradictory earlier registry/model-count receipts without rewriting their historical record.

## Gate20 mechanical and implementability correction — terminal

- U001's exact 23-entry payload mechanically contains 99 manifest rows and exactly 63 globally unique tracked step IDs: 53 across the 22 non-CRM aliases plus ten in `T-CRM`. Duplicate step IDs and unknown `T-CRM.groups[*].stepIds` are forbidden; `T-CRM` remains the exact seven-group map with one final receipt.
- Any historical 54-step receipt predating the ten-step T-CRM expansion is superseded for current cardinality. The 23 aliases, 99-row partition, seven T-CRM groups and all historical receipt text remain otherwise unchanged.
- `PLAN-PUBLISH` is non-destructive across interrupted recovery: only the fully absent state may create the branch/worktree, while an existing exact branch plus registered exact-path worktree may be reused only at the baseline SHA, on the correct branch, clean, non-symlinked and before the snapshot destination exists. Every mismatch exits before snapshot writes and never removes or overwrites existing state; the resulting five-file snapshot commit has the baseline as its sole parent.
