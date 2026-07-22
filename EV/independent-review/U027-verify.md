# U027 (OPS-01) independent adversarial security verification

Verdict: PASS_WITH_GAPS

Verifier: fresh non-author adversarial security verifier. Worktree
`/Users/jmpark/orca/workspaces/sangfor-os/sangfor-u027` (branch
`whelp99-code/sangfor-u027`, uncommitted, based on `44561b1f`). Live PG:
`postgres:16-alpine@sha256:57c72fd2…07777` on loopback :5466, migrations applied
via `prisma migrate deploy`, torn down after use.

One-line summary: the one-use external-action release receipt is **durably
single-use and fail-closed on every attack vector I ran** (replay, forge, expiry,
claims-mismatch, legacy null-policyHash, cross-scope) with no authority taken from
request JSON and no secret leakage; but there is **one real (fail-closed,
non-security) correctness defect** in the issuance idempotent-replay path and a
**major shortfall of the dispatch-mandated negative-matrix / durable test
coverage** — neither breaks the security boundary, hence PASS_WITH_GAPS rather
than PASS.

---

## Check 1 — Boundary: PASS

`git status` shows exactly the dispatch Create+Modify set and nothing else:

- Modified (7): `apps/web/.env.example`, `packages/business/src/governance/index.ts`,
  `services/sangfor-engineer-mcp/.env.example`, `.../apps/http-bridge/src/server.ts`,
  `.../apps/mcp-server/src/index.ts`, `.../packages/sangfor-approval/src/index.ts`,
  `.../packages/sangfor-operator/src/index.ts`.
- Untracked (10): business `external-action-release.ts`/`.test.ts`/`.integration.test.ts`,
  web `api/internal/external-actions/{releases,receipts/consume}/{route,route.test}.ts` (4),
  engineer `http-bridge/src/auth.ts`, `sangfor-approval/src/{release-client,internal-principal-client,internal-principal-client.test}.ts`,
  engineer `tests/{external-action-release,http-bridge-auth}.test.ts`.
- Root barrel `packages/business/src/index.ts` **unchanged** (`git diff` empty; still
  `export * from "./governance/index"`). `governance/index.ts` adds only the single
  `export * from "./external-action-release"` line (known merge point with U024).
- `sangfor-product-adapters/src/index.ts` is listed as a dispatch Modify but is
  **untouched** — allowed (no obligation to touch), not a violation.
- No second signed-principal decoder added; U026 read-only inputs untouched.

## Check 2 — One-use release receipt (core security): PASS (live-PG proven)

Because the delivered tests never drive the DB-backed issue/consume path (see
Check 5), I built an adversarial harness driving the **real**
`issueExternalActionRelease` / `consumeExternalActionRelease` inside a real
`prisma.$transaction`, routing the audit append to live Postgres while supplying
canned U023 provenance. Results (all live PG):

| Attack | Result | Evidence |
|---|---|---|
| (a) REPLAY consumed receipt in a NEW transaction | REJECTED `EXTERNAL_ACTION_RECEIPT_REPLAY` ("… already consumed"); 0 extra audit rows | durable single-use confirmed cross-transaction |
| (b) forged/tampered signature; alg-confusion (`alg:"none"`); wrong key | REJECTED `EXTERNAL_ACTION_RECEIPT_INVALID` | `verifyExternalActionReceipt` |
| (c) expired receipt (`now > exp`, exp=iat+60) | REJECTED `EXTERNAL_ACTION_RECEIPT_INVALID` | lifetime/skew check |
| (d) claims/target ≠ planned operation | REJECTED `EXTERNAL_ACTION_CLAIMS_MISMATCH` | engineer `release-client` live proof |
| (e) receipt bound to legacy null-policyHash approval | REJECTED at issuance `EXTERNAL_ACTION_RELEASE_DENIED` (owner fix) + consume defense-in-depth `… provenance is stale` | Check 3 |
| (f) cross-scope / wrong-principal-tenant consume | REJECTED `EXTERNAL_ACTION_RELEASE_DENIED` ("receipt scope does not match principal") before evaluate/audit | line 185 |

Durability backbone confirmed present in the live DB: partial unique index
`audit_logs_chain_scope_key_idempotency_key_key ON (chain_scope_key,
idempotency_key) WHERE idempotency_key IS NOT NULL`. Consume appends three unique
claims keyed on `jti`, `nonce`, `idempotencyKey`; any collision → REPLAY; whole
consume is wrapped in a `$transaction` (atomic rollback). No double-mint observed
(exactly one `external_action.issue` audit row per idempotencyKey).

Authority provenance: consume route (`receipts/consume/route.ts`) has **no**
user/session/API-key/bearer fallback — only a verified U026 ENGINEER
internal-principal envelope; the caller passed to the kernel is derived from the
**verified** principal + receipt, never from body/headers. Issuance route computes
`bodyHash` server-side via `externalActionCanonicalHash(operation)` and rejects any
unknown body key. Secret-free confirmed: receipt HMAC secret does not appear in
audit `details` (asserted in harness); `.env.example` carries placeholders only.

## Check 3 — Owner fix: PASS (correct + fail-closed)

`external-action-release.ts:175` (issuance, after approval/version existence):
`if (approval.policyHash === null) fail("EXTERNAL_ACTION_RELEASE_DENIED", "external
action requires a canonical policy-bound approval")`. Live-PG proof: a canned
approval with `policyHash=null` is **DENIED before any receipt or audit row is
minted** (0 rows for that idempotencyKey). Without the fix this would fall through
to `issueExternalActionReceipt`, which would then throw the generic
`RECEIPT_INVALID` (SHA256 guard) — a messier, non-policy failure; the fix converts
it to a clean fail-closed policy denial. Defense-in-depth at consume line 189
(`approval.policyHash !== claims.policyHash`): since `claims.policyHash` is
validated as 64-hex, a null DB value can never match → `… provenance is stale`
(live-proven). The fix resolved the sole real business TS error — `pnpm --filter
@sangfor/business typecheck` now EXIT 0. It weakens no other path (issuance-only
guard placed after the idempotency-replay short-circuit; consume path already
re-checked provenance).

## Check 4 — Engineer MCP hardening: PASS

- HTTP bridge auth (`auth.ts`): dedicated `SANGFOR_BRIDGE_CREDENTIAL`, SHA-256 +
  `timingSafeEqual` constant-time compare; bearer/API/user tokens explicitly
  ignored (unit test asserts `Bearer …` and wrong credential → undefined). `server.ts`
  swaps `authenticateApiKey/extractHttpApiKey` for `authenticateBridgeCredential`.
- Operator (`sangfor-operator/src/index.ts`): `assertRealExecutionAllowed` now
  throws `EXTERNAL_ACTION_RELEASE_REQUIRED` for **any** non-dry-run action; the old
  `SANGFOR_ALLOW_REAL_EXECUTION` / plaintext `approvedBy`/`approvalToken` authority
  is removed; live-action result string is the stable gate error.
- MCP tools (`mcp-server/src/index.ts`): `apply_approved_product_change` and
  `execute_console_action_live` now **require** `receipt/action/target/bodyHash/
  idempotencyKey` in their input schema and drop the approval-payload authority.
- Engineer signer (`internal-principal-client.ts`) is the only engineer signer,
  owns no receipt key, enforces the exact U026 ENGINEER profile (issuer/audience/
  service/sole-capability `external_action.receipt.consume`/request-bound hashes),
  and fixed constants (`TTL=60`, `SKEW=5`, owner `security-auth`).

## Check 5 — Acceptance re-run: PASS (all EXIT 0), but see Gaps

All dispatch acceptance commands EXIT 0 (after the documented fresh-worktree
bootstrap: build `@sangfor/config`/`auth`/`shared`/`health` + `db:generate`, and
`pnpm install` + `prisma generate` in the engineer service — all setup gaps, not
code defects):

- business unit `external-action-release.test.ts` — 2/2 ✓
- business integration (CI_INTEGRATION=1, DATABASE_URL=live) — 1/1 ✓ (no skip)
- web routes releases + consume — 2/2 ✓
- engineer 3 U027 files pass; full engineer suite 13 passed | 1 skipped (0 failed) ✓
- business typecheck 0 ✓ · web typecheck 0 ✓ · engineer lint 0 ✓ · engineer build 0 ✓
- `git diff --check` 0 ✓

Red-first: business unit + web-route + engineer tests contain negative assertions
(forged/padded/expired JWS; malformed key; ambient-bearer rejected at consume;
request-supplied approvedBy rejected at issuance). Present but **thin** — see Gap 2.

## Check 6 — Leaks: PASS

Docker container removed (verified gone); /tmp harnesses deleted. The ~17 owned
files + the owner 1-line fix remain the only **source** diff (my report under
`EV/independent-review/` is the sole added artifact, non-source).

---

## Gaps (why PASS_WITH_GAPS, not PASS)

**Gap 1 — Real correctness defect (fail-closed, non-security): idempotent-replay
path is dead code.** `external-action-release.ts:165` hand-builds the audit lookup
key as `` `${tenantId}:company:${companyId}:project:${projectId}` `` (=
`t1:company:c1:project:p1`), but every audit row is stored by `appendAuditEvent`
under `deriveChainScopeKey` = `` `project:${tenantId}:${companyId}:${projectId}` ``
(= `project:t1:c1:p1`, confirmed in the live DB). The two never match, so the
`existing` lookup at line 165 **always returns null** and the idempotent-replay
fast-path (lines 167-171) is unreachable. Consequences, proven on live PG:
- A legitimate same-key + same-hash issuance retry returns **409
  `EXTERNAL_ACTION_IDEMPOTENCY_CONFLICT` ("concurrent issuance must be retried")**
  instead of the contractually-required byte-identical receipt with
  `Idempotent-Replay: true` (Contract item 4; and the acceptance assertion "same
  issuance retry returns the byte-identical receipt" is factually false).
- Same-key + different-hash also rejects (safe) but via the wrong branch/message
  ("concurrent issuance must be retried" instead of "idempotency key is bound to
  different input").
- This is **fail-closed** — no double-mint (exactly one committed issue row per
  key), no second usable receipt, no security bypass. It is an
  availability/correctness break: normal network retries of issuance are forced
  into manual reconciliation. Root-cause fix: replace line 165's literal with
  `deriveChainScopeKey({...caller.scope, level: "PROJECT"})`.

**Gap 2 — Test coverage far below the dispatch's mandated negative matrix.** The
delivered tests exercise only the pure JWS crypto (2 business unit cases) + trivial
engineer smoke checks + 2 mocked web-route cases. The dispatch "Failing-first
proof" negative matrix (durable replay, claims-mismatch, legacy-policyHash,
idempotency-conflict, cross-scope, ambient/wrong-profile principal, rotation,
executor/audit counts, ambiguous-timeout) is almost entirely absent. Critically,
`external-action-release.integration.test.ts` is **misnamed**: it is gated on
`CI_INTEGRATION=1 && DATABASE_URL` but never touches Postgres (in-memory receipt
re-verify only), and its comment defers "durable replay coverage" to an "isolated
Postgres lifecycle" that does not exist in the delivered code. The durable
single-use / owner-fix / cross-scope behaviors were **unproven by the suite** until
I drove them myself on live PG — this is precisely the blind spot that hid Gap 1.

**Gap 3 — `internal-principal-client.test.ts` is never collected.** The engineer
vitest `include` is `tests/**` + `packages/sangfor-pptx/src/**` only; the file
lives under `packages/sangfor-approval/src/`, so acceptance line #4 does not
actually run the file it names. Its logic is covered indirectly by
`tests/external-action-release.test.ts`, so this is cosmetic, but the acceptance
command is misleading.

**Gap 4 — MANUAL_EXTERNAL_PENDING deferral: acceptable-as-deferred.**
`consumePlannedExternalAction` (the runtime consume client) is not wired into any
mcp-server handler. Mutating tools declare receipt inputs, but the product-change
handler (`change-execution.ts`, out-of-boundary and unchanged) ignores them and
still references plaintext approval — yet it hard-codes `mutationPerformed:false`
("real executor is not attached") and only calls `executeLiveConsoleAction` with
`dryRun:true`, while the operator disables all non-dry-run execution. So **no
external mutation can occur** and the fail-closed posture holds. The real
device/send/break-glass QA deferral is an external-device limitation and is
acceptable-as-deferred; Contract item 6 (engineer consume-then-execute-once) is
only unit-reachable via the consume client, not wired in runtime — acceptable
given the disabled-execution posture, but the owner should wire+prove it when the
real executor lands.

## Verdict rationale

Every enumerated PASS criterion for the security boundary holds and every attack I
launched fails closed: the one-use receipt is durably single-use, forge/expiry/
claims-mismatch/legacy-policyHash/cross-scope are all rejected, authority never
comes from request JSON, the engineer MCP is hardened, the owner fix is correct and
fail-closed, all acceptance commands EXIT 0, and there are no leaks. It is therefore
**safe to seal the receipt boundary from a security standpoint**. It is not a clean
PASS because of one genuine fail-closed correctness defect (Gap 1, breaking Contract
item 4 / an explicit acceptance assertion) and a coverage deficiency (Gap 2) that
left the core durability claim unproven in-repo. → **PASS_WITH_GAPS.**
