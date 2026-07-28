import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, cp, lstat, mkdir, mkdtemp as createTempRoot, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER_URL = pathToFileURL(path.join(REPO_ROOT, "scripts/run-test-alias.mjs")).href;
const ALIAS_MAP = JSON.parse(await readFile(path.join(REPO_ROOT, "docs/12_VERIFICATION/test-alias-map.json"), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const ownedRoots = new Set(), mkdtemp = async (prefix) => { const root = await createTempRoot(prefix); ownedRoots.add(root); return root; }; test.after(async () => { for (const root of ownedRoots) await rm(root, { recursive: true, force: true }); });
const bindingRoot = await realpath(await mkdtemp(path.join(tmpdir(), "u001-binding-")));
const unitContextFile = path.join(bindingRoot, "detached-release-mirror-context.json"), unitReceiptFile = path.join(bindingRoot, "detached-release-mirror-receipt.json");
const unitContextBytes = Buffer.from("verified unit mirror context\n"), unitReceiptBytes = Buffer.from("verified unit mirror receipt\n"); await Promise.all([writeFile(unitContextFile, unitContextBytes), writeFile(unitReceiptFile, unitReceiptBytes)]);
const MIRROR_BINDING = { contextFile: unitContextFile, contextHash: sha256(unitContextBytes), receiptFile: unitReceiptFile, receiptHash: sha256(unitReceiptBytes) };
const passingResult = (overrides = {}) => ({ exitCode: 0, signal: null, framework: "node:test", testCount: 1, skipped: 0, fixme: 0, todo: 0, only: 0, retried: 0, cleanup: { result: "NOT_REQUIRED", resources: 0 }, outputPaths: [], durationMs: 1, ...overrides });

const loadRunner = () => import(RUNNER_URL), assertMissing = async (target) => assert.rejects(() => lstat(target), (error) => error?.code === "ENOENT");
const artifactRecord = async (root, relative) => { const content = await readFile(path.join(root, relative)); return { path: relative, sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length }; };

const makeLeaseMap = (root) => Object.fromEntries(ALIAS_MAP.map((entry, index) => [entry.alias, { runId: `u001-alias-${index + 1}`, ownerUnit: entry.executionOwnerUnit, webPort: 4100 + (index * 2), apiPort: 4101 + (index * 2),
  leaseFile: path.join(root, `lease-${index + 1}.json`), evidenceDir: path.join(root, `evidence-${index + 1}`) }]));

const writeMirrorArtifacts = async (root, mirror, candidateSha) => {
  const receiptFile = path.join(root, "detached-release-mirror-receipt.json"), receipt = { schemaVersion: 1, runId: "mirror-run", ownerUnit: "U076", candidateSha, mirrorPath: "source", mirrorHead: candidateSha, detached: true, sourceStatusBefore: "", sourceStatusAfter: "", originalWorktreesBefore: [], originalWorktreesAfter: [], originalIgnoredEnvBefore: [], originalIgnoredEnvAfter: [], envScanCheckpoints: [], childEnvKeySets: [], installs: [], mode: "u076-final-aliases", commands: [], build: null, start: null, playwright: null, cleanup: { result: "PASS", resources: 0 }, result: "PASS", createdAt: "2026-07-17T00:00:00.000Z" };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`); await writeFile(receiptFile, receiptBytes);
  const contextFile = path.join(root, "detached-release-mirror-context.json"), receiptHash = sha256(receiptBytes), artifact = { schemaVersion: 1, mode: "u076-final-aliases", mirrorRoot: mirror, candidateSha, receiptFile, receiptHash };
  const contextBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`); await writeFile(contextFile, contextBytes);
  return { mode: "u076-final-aliases", detached: true, mirrorRoot: mirror, cwd: mirror, scriptPath: path.join(mirror, "scripts/run-test-alias.mjs"), headSha: candidateSha, candidateSha, status: "", envFiles: [], contextFile, contextHash: sha256(contextBytes), receiptFile, receiptHash };
};

const writeS9a = async (evidenceDir, finalCandidateSha) => {
  const directory = path.join(evidenceDir, "s9a"), rawFile = path.join(directory, "raw/receipt.json"); await mkdir(path.dirname(rawFile), { recursive: true });
  const raw = Buffer.from('{"result":"PASS"}\n'); await writeFile(rawFile, raw);
  const checks = Object.fromEntries(["dump", "restore", "schema", "tableCount", "contentHash", "sequence", "constraint", "migrationIdempotency", "rpo", "rto"].map((key) => [key, "PASS"]));
  const receipt = { schemaVersion: 1, unit: "U009", alias: "T-OPS", runId: "ops-run", finalCandidateSha, lockFileSha256: "c".repeat(64), imageDigest: `sha256:${"b".repeat(64)}`, postgresMajor: 16, restoreDrill: { argv: ["restore:drill"], exitCode: 0, rawReceiptRelativePath: "raw/receipt.json", rawReceiptSha256: sha256(raw), checks }, cleanup: { source: { containers: 0, networks: 0, volumes: 0 }, target: { containers: 0, networks: 0, volumes: 0 } }, result: "PASS", createdAt: "2026-07-27T00:00:00.000Z" };
  const receiptFile = path.join(directory, "receipt.json"), receiptBytes = Buffer.from(`${JSON.stringify(receipt)}\n`); await writeFile(receiptFile, receiptBytes); await writeFile(path.join(directory, "receipt.sha256"), `${sha256(receiptBytes)}\n`);
  return { receiptFile, rawFile, sidecarFile: path.join(directory, "receipt.sha256") };
};

test("runner accepts exactly one --alias argument", async () => {
  // Given
  const { parseAliasArguments } = await loadRunner();
  // When / Then
  assert.equal(parseAliasArguments(["--alias", "T-DOC"]), "T-DOC"); for (const argv of [[], ["--alias"], ["T-DOC"], ["--alias", "T-DOC", "extra"], ["--alias", "T-DOC", "--alias", "T-REL"]]) assert.throws(() => parseAliasArguments(argv), /exactly --alias/);
});

test("tracked Vitest steps use direct file-filtering invocations", () => {
  for (const entry of ALIAS_MAP) {
    for (const step of entry.steps) {
      const joined = step.argv.join(" ");
      assert.doesNotMatch(joined, /\bpnpm(?: --filter \S+)? (?:test|db:contract) --\b/, `${entry.alias}/${step.id}`);
    }
  }
});

test("23-alias lease map has exact six-field, unique resources", async (context) => {
  const { validateFinalAliasLeaseMap } = await loadRunner(), root = await mkdtemp(path.join(tmpdir(), "u001-leases-")), canonical = makeLeaseMap(root);
  assert.deepEqual(validateFinalAliasLeaseMap(canonical, ALIAS_MAP), canonical);
  const cases = [["extra database field", (map) => { map["T-DOC"].databaseUrl = "postgres://forbidden"; }], ["missing alias", (map) => { delete map["T-REL"]; }],
    ["wrong owner", (map) => { map["T-DOC"].ownerUnit = "U076"; }], ["shared run", (map) => { map["T-REL"].runId = map["T-DOC"].runId; }],
    ["shared port", (map) => { map["T-REL"].webPort = map["T-DOC"].webPort; }], ["shared evidence", (map) => { map["T-REL"].evidenceDir = map["T-DOC"].evidenceDir; }],
    ["equivalent evidence", (map) => { map["T-REL"].evidenceDir = `${map["T-DOC"].evidenceDir}/../${path.basename(map["T-DOC"].evidenceDir)}`; }]];
  for (const [name, mutate] of cases) {
    await context.test(name, () => { const fixture = structuredClone(canonical); mutate(fixture); assert.throws(() => validateFinalAliasLeaseMap(fixture, ALIAS_MAP), /lease map/); });
  }
});

test("lease file and evidence boundaries reject symbolic links", async (context) => { const { validateLeasePathBoundaries } = await loadRunner();
  for (const mode of ["leaseFile", "evidenceDir"]) await context.test(mode, async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "u001-lease-boundary-"))), map = makeLeaseMap(root);
    for (const value of Object.values(map)) { await mkdir(value.evidenceDir); await writeFile(value.leaseFile, "{}\n"); }
    await assert.doesNotReject(() => validateLeasePathBoundaries(map));
    const target = map["T-DOC"][mode], outside = path.join(root, `outside-${mode}`); await rm(target, { recursive: true });
    if (mode === "leaseFile") await writeFile(outside, "{}\n"); else await mkdir(outside);
    await symlink(outside, target); await assert.rejects(() => validateLeasePathBoundaries(map), new RegExp(`lease map ${mode} symbolic link or physical boundary invalid`));
  });
});

test("validated evidence root swap rejects before child execution and outside write", async () => { const { runTrackedSteps, validateLeasePathBoundaries } = await loadRunner(), root = await realpath(await mkdtemp(path.join(tmpdir(), "u001-root-swap-"))), map = makeLeaseMap(root);
  for (const value of Object.values(map)) { await mkdir(value.evidenceDir); await writeFile(value.leaseFile, "{}\n"); }
  const identities = await validateLeasePathBoundaries(map), evidenceDir = map["T-DOC"].evidenceDir, original = `${evidenceDir}-original`, outside = path.join(root, "outside"); await rename(evidenceDir, original); await mkdir(outside); await symlink(outside, evidenceDir); let spawned = 0;
  await assert.rejects(() => runTrackedSteps({ entry: { alias: "T-DOC", steps: [structuredClone(ALIAS_MAP[0].steps[0])] }, evidenceDir, evidenceIdentity: identities.get(evidenceDir), refs: { ALIAS_EVIDENCE_DIR: evidenceDir, FINAL_CANDIDATE_SHA: "a".repeat(40) }, mirrorContext: MIRROR_BINDING, runtimeBase: {}, spawnStep: async () => { spawned += 1; return passingResult(); } }), /validated evidence directory identity changed/);
  assert.equal(spawned, 0); await assertMissing(path.join(outside, "steps/registry/result.json"));
});

test("step env is allowlisted and required refs fail before spawn", async () => {
  // Given
  const { resolveStepEnvironment } = await loadRunner(), step = { env: { CI_INTEGRATION: { literal: "1" }, DATABASE_URL: { from: "TASK_OWNED_DATABASE_URL" } } };
  // When
  const resolved = resolveStepEnvironment(step, { TASK_OWNED_DATABASE_URL: "postgres://loopback/db" }, { PATH: "/bin", UX_FIXTURE_DEAL_ID: "deal-a", SECRET: "no" });
  // Then
  assert.deepEqual(resolved, { PATH: "/bin", UX_FIXTURE_DEAL_ID: "deal-a", CI_INTEGRATION: "1", DATABASE_URL: "postgres://loopback/db" });
  assert.throws(() => resolveStepEnvironment(step, {}, { PATH: "/bin" }), /missing environment ref TASK_OWNED_DATABASE_URL/);
  assert.deepEqual(resolveStepEnvironment({ env: {} }, {}, { PATH: "/bin", TASK_OWNED_DATABASE_URL: "postgres://must-not-leak" }), { PATH: "/bin" });
});

test("step invocation uses the mirror-root absolute wrapper without a shell", async () => {
  // Given
  const { buildStepInvocation } = await loadRunner(), step = { workspace: "root", argv: ["node", "script.mjs"] };
  // When
  const invocation = buildStepInvocation("/private/tmp/release-mirror", step);
  // Then
  assert.deepEqual(invocation, { command: "/private/tmp/release-mirror/scripts/run-workspace-runtime.sh", args: ["root", "--", "node", "script.mjs"], shell: false });
  assert.deepEqual(
    buildStepInvocation("/private/tmp/release-mirror", { workspace: "root", argv: ["--evidence", "$ACCEPTANCE_EVIDENCE_DIR"] }, { ACCEPTANCE_EVIDENCE_DIR: "/private/tmp/evidence" }).args,
    ["root", "--", "--evidence", "/private/tmp/evidence"],
  );
  assert.throws(
    () => buildStepInvocation("/private/tmp/release-mirror", { workspace: "root", argv: ["$ACCEPTANCE_EVIDENCE_DIR"] }),
    /absolute ACCEPTANCE_EVIDENCE_DIR/,
  );
});

test("mirror context binds detached root, script, candidate, cleanliness, and hashes", async () => {
  const { validateMirrorContext } = await loadRunner(), root = path.join(bindingRoot, "source"), sha = "a".repeat(40);
  const context = { mode: "u076-final-aliases", detached: true, mirrorRoot: root, cwd: root, scriptPath: `${root}/scripts/run-test-alias.mjs`, headSha: sha, candidateSha: sha, status: "", envFiles: [], ...MIRROR_BINDING };
  assert.deepEqual(validateMirrorContext(context), context);
  for (const mutate of [
    (value) => { value.detached = false; },
    (value) => { value.cwd = REPO_ROOT; },
    (value) => { value.headSha = "d".repeat(40); },
    (value) => { value.status = " M dirty"; },
    (value) => { value.envFiles = [".env"]; },
    (value) => { value.secret = "must-not-retain"; },
  ]) { const fixture = structuredClone(context); mutate(fixture); assert.throws(() => validateMirrorContext(fixture), /mirror context/); }
});

test("U007 pre-dispatch context remains exact-key valid after artifact verification", async () => {
  const { validateMirrorArtifacts, validateMirrorContext } = await loadRunner();
  const attempt = await realpath(await mkdtemp(path.join(tmpdir(), "u076-context-v2-")));
  const mirrorRoot = path.join(attempt, "source"), candidateSha = "a".repeat(40);
  const artifact = {
    schemaVersion: 1,
    mode: "u076-final-aliases",
    runId: "u076-context-test",
    ownerUnit: "U076",
    candidateSha,
    mirrorPath: mirrorRoot,
    mirrorHead: candidateSha,
    detached: true,
    sourceStatus: "clean",
    envCheckpointHash: "1".repeat(64),
    childEnvKeySetHash: "2".repeat(64),
    receiptSchemaHash: "3".repeat(64),
    createdAt: "2026-07-26T00:00:00.000Z",
  };
  const contextFile = path.join(attempt, "detached-release-mirror-context.json"), bytes = Buffer.from(`${JSON.stringify(artifact)}\n`);
  await writeFile(contextFile, bytes);
  const context = { mode: artifact.mode, detached: true, mirrorRoot, cwd: mirrorRoot, scriptPath: path.join(mirrorRoot, "scripts/run-test-alias.mjs"), headSha: candidateSha, candidateSha, status: "", envFiles: [], contextFile, contextHash: sha256(bytes) };
  const verified = await validateMirrorArtifacts(context);
  assert.deepEqual(verified, context);
  assert.deepEqual(validateMirrorContext(verified), context);
});

test("production normalization requires an explicit complete machine result", async () => {
  const { parseMachineResult } = await loadRunner(), valid = { framework: "node:test", testCount: 2, skipped: 0, fixme: 0, todo: 0, only: 0, retried: 0, outputs: [], cleanup: { result: "NOT_REQUIRED", resources: 0 } };
  assert.deepEqual(parseMachineResult(Buffer.from(`ALIAS_MACHINE_RESULT=${JSON.stringify(valid)}\n`)), valid);
  for (const output of [
    "3 passed\n",
    `ALIAS_MACHINE_RESULT=${JSON.stringify({ ...valid, testCount: "bogus" })}\n`,
    `ALIAS_MACHINE_RESULT=${JSON.stringify({ ...valid, skipped: 1 })}\n`,
    `ALIAS_MACHINE_RESULT=${JSON.stringify({ ...valid, cleanup: undefined })}\n`,
    `ALIAS_MACHINE_RESULT=${JSON.stringify({ ...valid, secret: "must-not-retain" })}\n`,
    `ALIAS_MACHINE_RESULT=${JSON.stringify({ ...valid, cleanup: { ...valid.cleanup, secret: "must-not-retain" } })}\n`,
  ]) assert.throws(() => parseMachineResult(Buffer.from(output)), /ALIAS_MACHINE_RESULT|machine result|strict nonzero-test PASS/);
  const browser = { ...valid, customerCaseIds: ["c"], opportunityCaseIds: ["o"], executedCaseIds: ["c", "o"] };
  assert.deepEqual(parseMachineResult(Buffer.from(`ALIAS_MACHINE_RESULT=${JSON.stringify(browser)}\n`), "crm-browser"), browser);
});

test("derived normalization rejects generic PASS and binds CRM cases to Playwright titles", async () => {
  const { deriveMachineResult } = await loadRunner();
  const evidenceDir = await mkdtemp(path.join(tmpdir(), "u076-derived-machine-"));
  const raw = { exitCode: 0, signal: null, stdout: Buffer.from("PASS overallPassed\n"), stderr: Buffer.alloc(0) };
  await assert.rejects(
    () => deriveMachineResult({ raw, step: { id: "unknown-contract" }, evidenceDir }),
    /strict nonzero-test PASS/,
  );
  await writeFile(path.join(evidenceDir, "playwright-receipt.json"), JSON.stringify({ totalTests: 2, skipped: 0 }));
  const semanticUi = await deriveMachineResult({
    raw: { ...raw, stdout: Buffer.alloc(0) },
    step: { id: "semantic-ui", argv: ["corepack", "pnpm", "test:acceptance"] },
    evidenceDir,
  });
  assert.equal(semanticUi.framework, "playwright");
  assert.equal(semanticUi.testCount, 2);
  await writeFile(path.join(evidenceDir, "playwright-report.json"), JSON.stringify({
    suites: [{ specs: [
      { title: "[customer] customer case" },
      { title: "[opportunity] opportunity case" },
    ] }],
  }));
  const browser = await deriveMachineResult({
    raw: { ...raw, stdout: Buffer.alloc(0) },
    step: { id: "crm-scope-pagination-browser" },
    evidenceDir,
    variant: "crm-browser",
  });
  assert.equal(browser.testCount, 2);
  assert.equal(browser.customerCaseIds.length, 1);
  assert.equal(browser.opportunityCaseIds.length, 1);
  assert.deepEqual(browser.executedCaseIds, [...browser.customerCaseIds, ...browser.opportunityCaseIds]);
});

test("structured CLI contracts ignore runtime diagnostics on stderr", async () => {
  const { deriveMachineResult } = await loadRunner();
  const evidenceDir = await mkdtemp(path.join(tmpdir(), "u076-structured-contract-"));
  const result = await deriveMachineResult({
    raw: {
      exitCode: 0,
      signal: null,
      stdout: Buffer.from("Operator drills contract runner executed\n"),
      stderr: Buffer.from("run-workspace-runtime: selected nvm.sh=/tmp/nvm.sh\n"),
    },
    step: { id: "operator-drills" },
    evidenceDir,
  });
  assert.equal(result.framework, "structured-contract");
  assert.equal(result.testCount, 1);
});

test("tenant restore drill accepts its strict successful payload", async () => {
  const { deriveMachineResult } = await loadRunner();
  const evidenceDir = await mkdtemp(path.join(tmpdir(), "u076-tenant-restore-contract-"));
  const payload = {
    evidenceDir,
    imported: true,
    idempotentReplay: true,
    tableCounts: { companies: 1, projects: 1, customers: 2, customer_activity_logs: 1 },
    remapCount: 6,
    targetCounts: { companies: 1, projects: 1, customers: 2, customer_activity_logs: 1 },
    tamperRejected: true,
    crossScopeRejected: true,
  };
  const result = await deriveMachineResult({
    raw: {
      exitCode: 0,
      signal: null,
      stdout: Buffer.from(`[U074] PASS ${JSON.stringify(payload)}\n`),
      stderr: Buffer.from("run-workspace-runtime: selected nvm.sh=/tmp/nvm.sh\n"),
    },
    step: { id: "tenant-restore-drill" },
    evidenceDir,
  });
  assert.equal(result.framework, "structured-contract");
  assert.equal(result.testCount, 1);
});

test("CLI fails closed on every Git revalidation error before leases or children", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "u001-alias-cli-"))), mirror = path.join(root, "source");
  await Promise.all([mkdir(path.join(mirror, "scripts"), { recursive: true }), mkdir(path.join(mirror, "docs/12_VERIFICATION"), { recursive: true })]);
  await Promise.all([cp(path.join(REPO_ROOT, "scripts/run-test-alias.mjs"), path.join(mirror, "scripts/run-test-alias.mjs")), cp(path.join(REPO_ROOT, "docs/12_VERIFICATION/test-alias-map.json"), path.join(mirror, "docs/12_VERIFICATION/test-alias-map.json"))]);
  const sha = "a".repeat(40), bin = path.join(root, "bin"), git = path.join(bin, "git"), wrapper = path.join(mirror, "scripts/run-workspace-runtime.sh"); await mkdir(bin);
  const writeGit = (failure = "none") => writeFile(git, `#!/bin/sh\n[ "$1" = "${failure}" ] && exit 55\ncase "$1" in rev-parse) echo ${sha};; status|ls-files) :;; symbolic-ref) exit 1;; *) exit 99;; esac\n`);
  await Promise.all([writeGit(), writeFile(wrapper, "#!/bin/sh\nprintf 'ran\\n' >> \"$0.ran\"\nprintf '3 passed\\n'\n")]); await Promise.all([chmod(git, 0o755), chmod(wrapper, 0o755)]);
  const leaseMap = makeLeaseMap(root); for (const lease of Object.values(leaseMap)) { await mkdir(lease.evidenceDir); await writeFile(lease.leaseFile, `${JSON.stringify(lease)}\n`); }
  const context = await writeMirrorArtifacts(root, mirror, sha);
  const run = (value) => spawnSync(process.execPath, [context.scriptPath, "--alias", "T-DOC"], { cwd: mirror, encoding: "utf8", env: { PATH: `${bin}:/bin:/usr/bin`, DETACHED_RELEASE_MIRROR_CONTEXT: JSON.stringify(value), FINAL_CANDIDATE_SHA: sha, FINAL_ALIAS_LEASE_MAP: JSON.stringify(leaseMap) } });
  const wrongHash = run({ ...context, contextHash: "0".repeat(64) }); assert.equal(wrongHash.status, 64, `${wrongHash.stdout}\n${wrongHash.stderr}`); assert.match(wrongHash.stderr, /mirror context artifact.*hash|context hash/);
  for (const command of ["status", "ls-files", "symbolic-ref", "rev-parse"]) { await writeGit(command); const failed = run(context); assert.equal(failed.status, 64, `${command}: ${failed.stdout}\n${failed.stderr}`); assert.match(failed.stderr, /Git mirror revalidation failed/); await Promise.all([assertMissing(`${wrapper}.ran`), assertMissing(path.join(leaseMap["T-DOC"].evidenceDir, "steps"))]); }
  await writeGit();
  const result = run(context); assert.equal(result.status, 64, `${result.stdout}\n${result.stderr}`); assert.match(result.stderr, /strict nonzero-test PASS|ALIAS_MACHINE_RESULT/);
});

test("step result seals mirror hashes and verified declared output metadata", async () => {
  const { runTrackedSteps } = await loadRunner(), evidenceDir = await mkdtemp(path.join(tmpdir(), "u001-step-seal-"));
  await writeFile(path.join(evidenceDir, "artifact.txt"), "sealed\n");
  const entry = { alias: "T-DOC", steps: [structuredClone(ALIAS_MAP[0].steps[0])] }, refs = { ALIAS_EVIDENCE_DIR: evidenceDir, FINAL_CANDIDATE_SHA: "a".repeat(40) };
  await runTrackedSteps({ entry, evidenceDir, refs, mirrorContext: MIRROR_BINDING, runtimeBase: {}, spawnStep: async () => passingResult({ outputPaths: ["artifact.txt"], machineResult: { secret: "must-not-retain" } }) });
  const sealed = JSON.parse(await readFile(path.join(evidenceDir, "steps/registry/result.json"), "utf8"));
  assert.equal(sealed.contextHash, MIRROR_BINDING.contextHash); assert.equal(sealed.receiptHash, MIRROR_BINDING.receiptHash);
  assert.deepEqual(Object.keys(sealed.declaredOutputs[0]).sort(), ["bytes", "path", "sha256"]); assert.equal(sealed.declaredOutputs[0].path, "artifact.txt"); assert.equal(sealed.machineResult, null);
});

test("runner rejects stale step and T-CRM closure destinations before spawn", async (context) => { const { runTrackedSteps } = await loadRunner();
  for (const mode of ["step", "crm-closure", "step-dangling-symlink", "step-parent-symlink"]) await context.test(mode, async () => {
    const evidenceDir = await mkdtemp(path.join(tmpdir(), "u001-stale-result-")), entry = mode === "crm-closure" ? structuredClone(ALIAS_MAP.find((candidate) => candidate.alias === "T-CRM")) : { alias: "T-DOC", steps: [structuredClone(ALIAS_MAP[0].steps[0])] };
    const target = mode === "crm-closure" ? path.join(evidenceDir, "t-crm-closure.json") : path.join(evidenceDir, "steps/registry/result.json"), parentLink = mode === "step-parent-symlink", outside = mode.includes("symlink") ? path.join(await mkdtemp(path.join(tmpdir(), "u001-step-dangling-")), "result.json") : null;
    await mkdir(parentLink ? path.dirname(path.dirname(target)) : path.dirname(target), { recursive: true }); if (parentLink) await symlink(path.dirname(outside), path.dirname(target)); else if (outside) await symlink(outside, target); else await writeFile(target, "stale\n");
    let spawned = 0;
    await assert.rejects(() => runTrackedSteps({ entry, evidenceDir, refs: { ALIAS_EVIDENCE_DIR: evidenceDir, FINAL_CANDIDATE_SHA: "a".repeat(40) }, mirrorContext: MIRROR_BINDING, runtimeBase: {}, spawnStep: async () => { spawned += 1; if (outside) await writeFile(outside, "spawned\n"); return passingResult(); } }), /pre-existing|fresh|evidence path/);
    assert.equal(spawned, 0); if (outside) await assertMissing(outside); else assert.equal(await readFile(target, "utf8"), "stale\n");
  });
  const evidenceDir = await realpath(await mkdtemp(path.join(tmpdir(), "u001-future-stale-"))), steps = ALIAS_MAP[0].steps.map((step) => structuredClone(step)), stale = path.join(evidenceDir, `steps/${steps[1].id}/result.json`), sideEffect = path.join(evidenceDir, "second-child-ran"); let spawned = 0;
  await assert.rejects(() => runTrackedSteps({ entry: { alias: "T-DOC", steps }, evidenceDir, refs: { ALIAS_EVIDENCE_DIR: evidenceDir, FINAL_CANDIDATE_SHA: "a".repeat(40) }, mirrorContext: MIRROR_BINDING, runtimeBase: {}, spawnStep: async (step) => { spawned += 1; if (step.id === steps[0].id) { await mkdir(path.dirname(stale), { recursive: true }); await writeFile(stale, "stale\n"); } else await writeFile(sideEffect, "ran\n"); return passingResult(); } }), /fresh evidence destination/);
  assert.equal(spawned, 1); assert.equal(await readFile(stale, "utf8"), "stale\n"); await assertMissing(sideEffect);
});

test("T-OPS derives a fresh S9a receipt and exposes it only to consumers", async () => {
  const { runTrackedSteps } = await loadRunner(), evidenceDir = await mkdtemp(path.join(tmpdir(), "u001-ops-"));
  const entry = structuredClone(ALIAS_MAP.find((candidate) => candidate.alias === "T-OPS")), seen = [], sha = "a".repeat(40);
  await runTrackedSteps({
    entry, evidenceDir, mirrorContext: MIRROR_BINDING, refs: { ALIAS_EVIDENCE_DIR: evidenceDir, ALIAS_RUN_ID: "ops-run", ALIAS_LEASE_FILE: "/tmp/lease", ALIAS_WEB_PORT: "4100", ALIAS_API_PORT: "4101", FINAL_CANDIDATE_SHA: sha }, runtimeBase: { PATH: "/bin" },
    spawnStep: async (step, env) => {
      seen.push([step.id, env.S9A_RECEIPT_FILE]); if (step.id === "fresh-s9a-final-candidate") await writeS9a(evidenceDir, sha); return passingResult();
    },
  });
  assert.deepEqual(seen.map(([id]) => id), ["fresh-s9a-final-candidate", "operator-drills", "tenant-restore-drill", "tenant-restore-contract"]); assert.equal(seen[0][1], undefined); assert.equal(seen[1][1], undefined);
  assert.equal(seen[2][1], path.join(evidenceDir, "s9a/receipt.json")); assert.equal(seen[3][1], path.join(evidenceDir, "s9a/receipt.json"));
});

test("T-OPS rejects symlinked or hash-unbound S9a evidence before consumers", async (context) => {
  const { runTrackedSteps } = await loadRunner(), entry = structuredClone(ALIAS_MAP.find((candidate) => candidate.alias === "T-OPS"));
  for (const mode of ["receipt-symlink", "raw-tamper", "sidecar-tamper"]) await context.test(mode, async () => {
    const evidenceDir = await mkdtemp(path.join(tmpdir(), "u001-ops-binding-")), refs = { ALIAS_EVIDENCE_DIR: evidenceDir, ALIAS_RUN_ID: "ops-run", ALIAS_LEASE_FILE: "/tmp/lease", ALIAS_WEB_PORT: "4100", ALIAS_API_PORT: "4101", FINAL_CANDIDATE_SHA: "a".repeat(40) }; let spawned = 0;
    await assert.rejects(() => runTrackedSteps({ entry, evidenceDir, refs, mirrorContext: MIRROR_BINDING, runtimeBase: {}, spawnStep: async (step) => {
      spawned += 1;
      if (step.id === "fresh-s9a-final-candidate") {
        const files = await writeS9a(evidenceDir, refs.FINAL_CANDIDATE_SHA);
        if (mode === "receipt-symlink") { const outside = path.join(await mkdtemp(path.join(tmpdir(), "u001-ops-outside-")), "receipt.json"); await writeFile(outside, await readFile(files.receiptFile)); await rm(files.receiptFile); await symlink(outside, files.receiptFile); }
        if (mode === "raw-tamper") await writeFile(files.rawFile, "tampered\n"); if (mode === "sidecar-tamper") await writeFile(files.sidecarFile, `${"0".repeat(64)}\n`);
      }
      return passingResult();
    } }), /S9a receipt/);
    assert.equal(spawned, 1);
  });
});

test("T-OPS rejects caller injection and pre-existing receipts before spawn", async (context) => {
  const { runTrackedSteps } = await loadRunner(), entry = structuredClone(ALIAS_MAP.find((candidate) => candidate.alias === "T-OPS"));
  for (const mode of ["caller", "preexisting", "dangling-symlink", "parent-symlink"]) {
    await context.test(mode, async () => {
      const evidenceDir = await mkdtemp(path.join(tmpdir(), "u001-ops-reject-")), refs = { ALIAS_EVIDENCE_DIR: evidenceDir, ALIAS_RUN_ID: "ops-run", ALIAS_LEASE_FILE: "/tmp/lease", ALIAS_WEB_PORT: "4100", ALIAS_API_PORT: "4101", FINAL_CANDIDATE_SHA: "a".repeat(40) };
      const outside = mode.endsWith("symlink") ? path.join(await mkdtemp(path.join(tmpdir(), "u001-ops-dangling-")), "receipt.json") : null;
      if (mode === "caller") refs.ALIAS_S9A_RECEIPT_FILE = path.join(evidenceDir, "s9a/receipt.json");
      if (mode === "preexisting") { await mkdir(path.join(evidenceDir, "s9a")); await writeFile(path.join(evidenceDir, "s9a/receipt.json"), "stale\n"); }
      if (outside) { if (mode === "parent-symlink") await symlink(path.dirname(outside), path.join(evidenceDir, "s9a")); else { await mkdir(path.join(evidenceDir, "s9a")); await symlink(outside, path.join(evidenceDir, "s9a/receipt.json")); } }
      let spawned = 0;
      await assert.rejects(() => runTrackedSteps({ entry, evidenceDir, refs, mirrorContext: MIRROR_BINDING, runtimeBase: {}, spawnStep: async () => { spawned += 1; if (outside) await writeFile(outside, "spawned\n"); return passingResult(); } }), /S9a receipt|evidence path/);
      assert.equal(spawned, 0); if (outside) await assertMissing(outside);
    });
  }
});

test("T-OPS validates the fresh producer receipt before operator or consumers", async () => {
  const { runTrackedSteps } = await loadRunner();
  const evidenceDir = await mkdtemp(path.join(tmpdir(), "u001-ops-invalid-"));
  const entry = structuredClone(ALIAS_MAP.find((candidate) => candidate.alias === "T-OPS"));
  const refs = { ALIAS_EVIDENCE_DIR: evidenceDir, ALIAS_RUN_ID: "ops-run", ALIAS_LEASE_FILE: "/tmp/lease", ALIAS_WEB_PORT: "4100", ALIAS_API_PORT: "4101", FINAL_CANDIDATE_SHA: "a".repeat(40) };
  const seen = [];
  await assert.rejects(() => runTrackedSteps({ entry, evidenceDir, refs, mirrorContext: MIRROR_BINDING, runtimeBase: {}, spawnStep: async (step) => {
    seen.push(step.id);
    const receiptFile = path.join(evidenceDir, "s9a/receipt.json");
    await mkdir(path.dirname(receiptFile), { recursive: true });
    await writeFile(receiptFile, `${JSON.stringify({ unit: "U074" })}\n`);
    return passingResult();
  } }), /S9a receipt/);
  assert.deepEqual(seen, ["fresh-s9a-final-candidate"]);
});

test("T-CRM seals seven disjoint groups and fails overlapping browser credit", async () => {
  const { validateCrmClosure } = await loadRunner();
  const evidenceDir = await mkdtemp(path.join(tmpdir(), "u001-crm-"));
  const entry = structuredClone(ALIAS_MAP.find((candidate) => candidate.alias === "T-CRM"));
  const outputs = [...new Set(entry.groups.flatMap((group) => group.outputs))];
  for (const relative of outputs) { const target = path.join(evidenceDir, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, "evidence\n"); }
  const results = entry.steps.map((step) => ({ id: step.id, testCount: step.id === "crm-scope-pagination-browser" ? 2 : 1, declaredOutputs: [], machineResult: step.id === "crm-scope-pagination-browser" ? { customerCaseIds: ["customer-a"], opportunityCaseIds: ["opportunity-a"], executedCaseIds: ["customer-a", "opportunity-a"] } : null }));
  for (const group of entry.groups) for (const relative of group.outputs.filter((output) => !/^steps\/[^/]+\/result\.json$/.test(output))) {
    results.find((result) => result.id === group.stepIds[0]).declaredOutputs.push(await artifactRecord(evidenceDir, relative));
  }
  const closure = await validateCrmClosure(entry, evidenceDir, results);
  assert.equal(closure.groups.length, 7);
  assert.equal(JSON.parse(await readFile(path.join(evidenceDir, "t-crm-closure.json"), "utf8")).alias, "T-CRM");
  const overlapping = structuredClone(results);
  overlapping.find((result) => result.id === "crm-scope-pagination-browser").machineResult.opportunityCaseIds = ["customer-a"];
  const overlapDir = await mkdtemp(path.join(tmpdir(), "u001-crm-overlap-"));
  await assert.rejects(() => validateCrmClosure(entry, overlapDir, overlapping), /disjoint and complete/);
  for (const [field, value] of [
    ["customerCaseIds", ["customer-a", "customer-a"]],
    ["opportunityCaseIds", ["opportunity-a", "opportunity-a"]],
    ["executedCaseIds", ["customer-a", "opportunity-a", "opportunity-a"]],
  ]) {
    const duplicated = structuredClone(results);
    duplicated.find((result) => result.id === "crm-scope-pagination-browser").machineResult[field] = value;
    await assert.rejects(() => validateCrmClosure(entry, evidenceDir, duplicated), /unique|disjoint and complete/);
  }
  for (const count of [1, 3]) {
    const mismatched = structuredClone(results);
    mismatched.find((result) => result.id === "crm-scope-pagination-browser").testCount = count;
    await assert.rejects(() => validateCrmClosure(entry, evidenceDir, mismatched), /browser testCount/);
  }
});

test("T-CRM rejects a declared output symlink that resolves outside evidence", async () => {
  const { validateCrmClosure } = await loadRunner();
  const evidenceDir = await mkdtemp(path.join(tmpdir(), "u001-crm-symlink-"));
  const entry = structuredClone(ALIAS_MAP.find((candidate) => candidate.alias === "T-CRM"));
  const escaped = entry.groups[0].outputs[1];
  for (const relative of new Set(entry.groups.flatMap((group) => group.outputs))) {
    const target = path.join(evidenceDir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    if (relative === escaped) continue;
    await writeFile(target, "evidence\n");
  }
  const outside = path.join(await mkdtemp(path.join(tmpdir(), "u001-crm-outside-")), "outside.txt");
  await writeFile(outside, "outside\n");
  await symlink(outside, path.join(evidenceDir, escaped));
  const results = entry.steps.map((step) => ({ id: step.id, testCount: step.id === "crm-scope-pagination-browser" ? 2 : 1, machineResult: step.id === "crm-scope-pagination-browser" ? { customerCaseIds: ["c"], opportunityCaseIds: ["o"], executedCaseIds: ["c", "o"] } : null }));
  await assert.rejects(() => validateCrmClosure(entry, evidenceDir, results), /symbolic link|physical evidence directory/);
});
