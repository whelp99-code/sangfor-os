import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { lstat, mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const LEASE_KEYS = ["apiPort", "evidenceDir", "leaseFile", "ownerUnit", "runId", "webPort"];
const RUNTIME_BASE_KEYS = ["COREPACK_HOME", "HOME", "LANG", "LC_ALL", "NVM_DIR", "NO_COLOR", "PATH", "PNPM_HOME", "SHELL", "TERM", "TMPDIR", "XDG_CACHE_HOME"];
const OPS_ORDER = ["fresh-s9a-final-candidate", "operator-drills", "tenant-restore-drill", "tenant-restore-contract"];
const CONTEXT_KEYS = ["candidateSha", "contextFile", "contextHash", "cwd", "detached", "envFiles", "headSha", "mirrorRoot", "mode", "receiptFile", "receiptHash", "scriptPath", "status"];
const CONTEXT_ARTIFACT_KEYS = ["candidateSha", "mirrorRoot", "mode", "receiptFile", "receiptHash", "schemaVersion"];
const MIRROR_RECEIPT_KEYS = ["build", "candidateSha", "childEnvKeySets", "cleanup", "commands", "createdAt", "detached", "envScanCheckpoints", "installs", "mirrorHead", "mirrorPath", "mode", "originalIgnoredEnvAfter", "originalIgnoredEnvBefore", "originalWorktreesAfter", "originalWorktreesBefore", "ownerUnit", "playwright", "result", "runId", "schemaVersion", "sourceStatusAfter", "sourceStatusBefore", "start"];
const MACHINE_KEYS = ["cleanup", "fixme", "framework", "only", "outputs", "retried", "skipped", "testCount", "todo"];
const CRM_MACHINE_KEYS = [...MACHINE_KEYS, "customerCaseIds", "executedCaseIds", "opportunityCaseIds"].sort();
const S9A_KEYS = ["alias", "checks", "cleanup", "exitCode", "finalCandidateSha", "pinnedDigest", "postgresVersion", "rawReceiptRelativePath", "rawReceiptSha256", "runId", "sentinelMatch", "unit"];
const SHA40 = /^[a-f0-9]{40}$/, SHA64 = /^[a-f0-9]{64}$/, UNIT = /^U(?:00[1-9]|0[1-6][0-9]|07[0-6])$/;

class AliasRunnerError extends Error {}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right), hash = (value) => createHash("sha256").update(value).digest("hex");
const inside = (root, target) => { const relative = path.relative(root, target); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); };
const evidenceEntryExists = async (root, target, create = false) => {
  const relative = path.relative(path.resolve(root), path.resolve(target)); if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new AliasRunnerError("evidence path escapes canonical root");
  const parts = relative === "" ? [] : relative.split(path.sep); let current = await realpath(root);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part); let metadata;
    try { metadata = await lstat(current); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; if (!create) return false; await mkdir(current); metadata = await lstat(current); }
    if (metadata.isSymbolicLink() || ((create || index < parts.length - 1) && !metadata.isDirectory())) throw new AliasRunnerError("evidence path component must be a real directory, never a symlink");
  } return true;
};
const assertEvidenceIdentity = async (identity) => { let metadata, resolved;
  try { metadata = await lstat(identity.path); resolved = await realpath(identity.path); } catch { throw new AliasRunnerError("validated evidence directory identity changed"); }
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || resolved !== identity.path || metadata.dev !== identity.dev || metadata.ino !== identity.ino) throw new AliasRunnerError("validated evidence directory identity changed");
};
const captureEvidenceIdentity = async (root) => { const metadata = await lstat(root), resolved = await realpath(root);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new AliasRunnerError("evidence directory must be a real directory, never a symlink");
  return Object.freeze({ path: resolved, dev: metadata.dev, ino: metadata.ino });
};
const reserveJson = async (root, target, identity) => { await assertEvidenceIdentity(identity);
  if (await evidenceEntryExists(root, target)) throw new AliasRunnerError(`fresh evidence destination required: ${target}`); await evidenceEntryExists(root, path.dirname(target), true); await assertEvidenceIdentity(identity); let file;
  try { file = await open(target, "wx", 0o600); await assertEvidenceIdentity(identity); const [opened, linked] = await Promise.all([file.stat(), lstat(target)]); if (linked.isSymbolicLink() || !linked.isFile() || linked.dev !== opened.dev || linked.ino !== opened.ino) throw new AliasRunnerError(`reserved evidence destination changed: ${target}`); } catch (error) { await file?.close(); if (error instanceof AliasRunnerError) throw error; throw new AliasRunnerError(`fresh evidence destination required: ${target} (${error instanceof Error ? error.message : String(error)})`); }
  return { file, identity, target };
};
const sealJson = async (reservation, value) => { await assertEvidenceIdentity(reservation.identity);
  const [opened, linked] = await Promise.all([reservation.file.stat(), lstat(reservation.target)]);
  if (linked.isSymbolicLink() || !linked.isFile() || linked.dev !== opened.dev || linked.ino !== opened.ino) throw new AliasRunnerError(`reserved evidence destination changed: ${reservation.target}`);
  await reservation.file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await reservation.file.sync(); await assertEvidenceIdentity(reservation.identity); const sealed = await lstat(reservation.target); if (sealed.isSymbolicLink() || !sealed.isFile() || sealed.dev !== opened.dev || sealed.ino !== opened.ino) throw new AliasRunnerError(`reserved evidence destination changed: ${reservation.target}`);
};
const atomicJson = async (root, target, value, identity) => { const reservation = await reserveJson(root, target, identity ?? await captureEvidenceIdentity(root));
  try { await sealJson(reservation, value); } finally { await reservation.file.close(); }
};

export const parseAliasArguments = (argv) => { if (argv.length !== 2 || argv[0] !== "--alias" || typeof argv[1] !== "string" || argv[1].length === 0) throw new AliasRunnerError("expected exactly --alias <alias>"); return argv[1]; };

export const validateFinalAliasLeaseMap = (leaseMap, aliases) => { if (!leaseMap || typeof leaseMap !== "object" || Array.isArray(leaseMap)) throw new AliasRunnerError("lease map must be an object");
  const expectedAliases = aliases.map((entry) => entry.alias).sort(), unique = { runId: new Set(), port: new Set(), leaseFile: new Set(), evidenceDir: new Set() }; if (!same(Object.keys(leaseMap).sort(), expectedAliases)) throw new AliasRunnerError("lease map alias set must exactly match test aliases");
  for (const entry of aliases) { const value = leaseMap[entry.alias];
    if (!value || !same(Object.keys(value).sort(), LEASE_KEYS)) throw new AliasRunnerError(`lease map ${entry.alias} must have exact six-field shape`);
    if (typeof value.runId !== "string" || value.runId.length === 0 || value.ownerUnit !== entry.executionOwnerUnit || !UNIT.test(value.ownerUnit)) throw new AliasRunnerError(`lease map ${entry.alias} identity mismatch`);
    if (![value.webPort, value.apiPort].every((port) => Number.isInteger(port) && port > 0 && port < 65536) || value.webPort === value.apiPort) throw new AliasRunnerError(`lease map ${entry.alias} ports invalid`);
    if (![value.leaseFile, value.evidenceDir].every((item) => typeof item === "string" && path.isAbsolute(item))) throw new AliasRunnerError(`lease map ${entry.alias} paths must be absolute`);
    for (const [field, item] of [["runId", value.runId], ["leaseFile", value.leaseFile], ["evidenceDir", value.evidenceDir]]) {
      const identity = field === "runId" ? item : path.resolve(item); if (unique[field].has(identity)) throw new AliasRunnerError(`lease map ${field} must be unique`); unique[field].add(identity);
    }
    for (const port of [value.webPort, value.apiPort]) { if (unique.port.has(port)) throw new AliasRunnerError("lease map ports must be globally unique"); unique.port.add(port); }
  } return leaseMap; };

export const validateLeasePathBoundaries = async (leaseMap) => { const physical = { leaseFile: new Set(), evidenceDir: new Set() }, identities = new Map();
  for (const value of Object.values(leaseMap)) for (const [field, expected] of [["leaseFile", "file"], ["evidenceDir", "directory"]]) {
    const target = value[field], metadata = await lstat(target); if (metadata.isSymbolicLink() || (expected === "file" ? !metadata.isFile() : !metadata.isDirectory())) throw new AliasRunnerError(`lease map ${field} symbolic link or physical boundary invalid`); const resolved = await realpath(target);
    if (resolved !== path.resolve(target) || physical[field].has(resolved)) throw new AliasRunnerError(`lease map ${field} physical boundary must be canonical and unique`); physical[field].add(resolved); if (field === "evidenceDir") identities.set(target, Object.freeze({ path: resolved, dev: metadata.dev, ino: metadata.ino }));
  }
  return identities; };

export const resolveStepEnvironment = (step, refs, runtimeBase) => { const environment = {};
  for (const key of RUNTIME_BASE_KEYS) if (typeof runtimeBase[key] === "string" && runtimeBase[key].length > 0) environment[key] = runtimeBase[key];
  for (const [name, descriptor] of Object.entries(step.env)) { if (Object.hasOwn(descriptor, "literal")) environment[name] = descriptor.literal;
    else { const value = refs[descriptor.from]; if (typeof value !== "string" || value.length === 0) throw new AliasRunnerError(`missing environment ref ${descriptor.from}`); environment[name] = value; }
  }
  return environment; };

export const buildStepInvocation = (mirrorRoot, step) => ({
  command: path.join(mirrorRoot, "scripts/run-workspace-runtime.sh"), args: [step.workspace, "--", ...step.argv], shell: false,
});

const validateRuntimeWrapper = async (mirrorRoot) => {
  const wrapper = path.join(mirrorRoot, "scripts/run-workspace-runtime.sh"), metadata = await lstat(wrapper); if (metadata.isSymbolicLink() || !metadata.isFile() || await realpath(wrapper) !== wrapper) throw new AliasRunnerError("runtime wrapper must be a regular file in the physical mirror root");
};

export const validateMirrorContext = (context) => {
  const attemptRoot = path.dirname(context?.mirrorRoot ?? "");
  const valid = context && same(Object.keys(context).sort(), CONTEXT_KEYS) && context.mode === "u076-final-aliases" && context.detached === true && path.isAbsolute(context.mirrorRoot ?? "") && context.cwd === context.mirrorRoot
    && context.mirrorRoot === path.join(attemptRoot, "source") && context.scriptPath === path.join(context.mirrorRoot, "scripts/run-test-alias.mjs") && context.headSha === context.candidateSha && SHA40.test(context.headSha ?? "")
    && context.status === "" && Array.isArray(context.envFiles) && context.envFiles.length === 0 && context.contextFile === path.join(attemptRoot, "detached-release-mirror-context.json") && context.receiptFile === path.join(attemptRoot, "detached-release-mirror-receipt.json") && SHA64.test(context.contextHash ?? "") && SHA64.test(context.receiptHash ?? "");
  if (!valid) throw new AliasRunnerError("mirror context is not a clean detached final candidate");
  return context;
};

export const validateMirrorArtifacts = async (context) => {
  validateMirrorContext(context);
  const readBound = async (file, expectedHash, label) => {
    const metadata = await lstat(file), physical = await realpath(file);
    if (metadata.isSymbolicLink() || !metadata.isFile() || physical !== path.resolve(file)) throw new AliasRunnerError(`${label} must be a canonical regular non-symlink artifact`);
    const bytes = await readFile(file); if (hash(bytes) !== expectedHash) throw new AliasRunnerError(`${label} hash mismatch`);
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  };
  const receipt = await readBound(context.receiptFile, context.receiptHash, "mirror receipt artifact");
  const receiptValid = same(Object.keys(receipt.value).sort(), MIRROR_RECEIPT_KEYS) && receipt.value.schemaVersion === 1 && receipt.value.ownerUnit === "U076" && receipt.value.mode === context.mode && receipt.value.candidateSha === context.candidateSha && receipt.value.mirrorHead === context.candidateSha && receipt.value.mirrorPath === "source" && receipt.value.detached === true && receipt.value.result === "PASS";
  if (!receiptValid) throw new AliasRunnerError("mirror receipt artifact exact shape or identity mismatch");
  const artifact = await readBound(context.contextFile, context.contextHash, "mirror context artifact"), expected = { schemaVersion: 1, mode: context.mode, mirrorRoot: context.mirrorRoot, candidateSha: context.candidateSha, receiptFile: context.receiptFile, receiptHash: context.receiptHash };
  if (!same(Object.keys(artifact.value).sort(), CONTEXT_ARTIFACT_KEYS) || !same(artifact.value, expected)) throw new AliasRunnerError("mirror context artifact exact shape or identity mismatch");
  return Object.freeze({ ...context });
};

const validateS9aReceiptBody = async (receiptFile, refs, evidenceDir) => {
  const root = await realpath(evidenceDir), expectedReceipt = path.join(root, "s9a/receipt.json");
  const metadata = await lstat(receiptFile), physical = await realpath(receiptFile);
  if (metadata.isSymbolicLink() || !metadata.isFile() || physical !== expectedReceipt) throw new AliasRunnerError("S9a receipt must be a canonical contained regular non-symlink file");
  const receiptBytes = await readFile(receiptFile), receipt = JSON.parse(receiptBytes.toString("utf8"));
  const rawFile = path.join(root, "s9a/raw/receipt.json"), sidecarFile = path.join(root, "s9a/receipt.sha256");
  const rawMetadata = await lstat(rawFile), sidecarMetadata = await lstat(sidecarFile);
  if ([rawMetadata, sidecarMetadata].some((value) => value.isSymbolicLink() || !value.isFile()) || await realpath(rawFile) !== rawFile || await realpath(sidecarFile) !== sidecarFile) throw new AliasRunnerError("S9a receipt raw/sidecar must be canonical contained regular files");
  const rawBytes = await readFile(rawFile), sidecar = await readFile(sidecarFile, "utf8");
  const checks = ["dump", "restore", "hash", "sequence", "migration"];
  const clean = receipt.cleanup && ["containers", "networks", "volumes"].every((key) => receipt.cleanup[key] === 0);
  const valid = same(Object.keys(receipt).sort(), S9A_KEYS) && receipt.unit === "U009" && receipt.alias === "T-OPS" && receipt.runId === refs.ALIAS_RUN_ID && receipt.finalCandidateSha === refs.FINAL_CANDIDATE_SHA && /^sha256:[a-f0-9]{64}$/.test(receipt.pinnedDigest ?? "")
    && receipt.postgresVersion === 16 && receipt.exitCode === 0 && checks.every((key) => receipt.checks?.[key] === "PASS") && receipt.sentinelMatch === true && clean && receipt.rawReceiptRelativePath === "raw/receipt.json" && receipt.rawReceiptSha256 === hash(rawBytes) && sidecar === `${hash(receiptBytes)}\n`;
  if (!valid) throw new AliasRunnerError("S9a receipt does not match final alias/run/PostgreSQL16 cleanup contract");
};

const validateS9aReceipt = async (...args) => {
  try { await validateS9aReceiptBody(...args); }
  catch (error) { throw new AliasRunnerError(`S9a receipt invalid: ${error instanceof Error ? error.message : String(error)}`); }
};

const checkedArtifact = async (evidenceDir, relative) => {
  if (typeof relative !== "string" || relative.length === 0 || path.isAbsolute(relative) || path.normalize(relative) !== relative) throw new AliasRunnerError(`declared output path is not a normalized relative path: ${relative}`);
  const root = await realpath(evidenceDir), absolute = path.resolve(root, relative);
  if (!inside(root, absolute)) throw new AliasRunnerError(`declared output escapes evidence directory: ${relative}`);
  const metadata = await lstat(absolute); if (metadata.isSymbolicLink()) throw new AliasRunnerError(`declared output is a symbolic link: ${relative}`);
  const physical = await realpath(absolute);
  if (physical !== absolute || !inside(root, physical)) throw new AliasRunnerError(`declared output escapes physical evidence directory: ${relative}`);
  if (!metadata.isFile() || metadata.size === 0) throw new AliasRunnerError(`declared output is missing or empty: ${relative}`);
  return { path: relative, sha256: hash(await readFile(absolute)), bytes: metadata.size };
};

const strictMachineResult = (result, variant = "base") => result && typeof result === "object" && !Array.isArray(result) && same(Object.keys(result).sort(), variant === "crm-browser" ? CRM_MACHINE_KEYS : MACHINE_KEYS)
  && typeof result.framework === "string" && result.framework.length > 0 && Number.isInteger(result.testCount) && result.testCount > 0 && [result.skipped, result.fixme, result.todo, result.only, result.retried].every((count) => Number.isInteger(count) && count === 0)
  && Array.isArray(result.outputs) && new Set(result.outputs).size === result.outputs.length && result.outputs.every((value) => typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && path.normalize(value) === value)
  && result.cleanup && typeof result.cleanup === "object" && same(Object.keys(result.cleanup).sort(), ["resources", "result"]) && ["PASS", "NOT_REQUIRED"].includes(result.cleanup.result) && Number.isInteger(result.cleanup.resources) && result.cleanup.resources === 0
  && (variant !== "crm-browser" || [result.customerCaseIds, result.opportunityCaseIds, result.executedCaseIds].every((value) => Array.isArray(value) && value.every((id) => typeof id === "string" && id.length > 0)));

export const parseMachineResult = (stdout, variant = "base") => {
  const lines = Buffer.from(stdout).toString("utf8").split("\n").filter((line) => line.startsWith("ALIAS_MACHINE_RESULT=")); if (lines.length !== 1) throw new AliasRunnerError("exactly one ALIAS_MACHINE_RESULT is required"); let result;
  try { result = JSON.parse(lines[0].slice("ALIAS_MACHINE_RESULT=".length)); }
  catch { throw new AliasRunnerError("ALIAS_MACHINE_RESULT must be valid JSON"); }
  if (!strictMachineResult(result, variant)) throw new AliasRunnerError("machine result did not prove a strict nonzero-test PASS");
  const sanitized = { framework: result.framework, testCount: result.testCount, skipped: result.skipped, fixme: result.fixme, todo: result.todo, only: result.only, retried: result.retried, outputs: [...result.outputs], cleanup: { result: result.cleanup.result, resources: result.cleanup.resources } };
  if (variant === "crm-browser") for (const key of ["customerCaseIds", "opportunityCaseIds", "executedCaseIds"]) sanitized[key] = [...result[key]];
  return sanitized;
};

export const validateCrmClosure = async (entry, evidenceDir, stepResults, evidenceIdentity) => {
  const browserResult = stepResults.find((result) => result.id === "crm-scope-pagination-browser"), browser = browserResult?.machineResult;
  const customerCases = browser?.customerCaseIds, opportunityCases = browser?.opportunityCaseIds, executedCases = browser?.executedCaseIds;
  const uniqueCases = (value) => Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === "string" && id.length > 0) && new Set(value).size === value.length;
  if (![customerCases, opportunityCases, executedCases].every(uniqueCases)) throw new AliasRunnerError("T-CRM browser case partitions must contain unique non-empty IDs");
  const union = [...customerCases, ...opportunityCases].sort();
  if (customerCases.some((id) => opportunityCases.includes(id)) || !same(union, [...executedCases].sort())) throw new AliasRunnerError("T-CRM browser case partitions must be disjoint and complete");
  if (browserResult?.testCount !== executedCases.length) throw new AliasRunnerError("T-CRM browser testCount must equal the exact executed case set");
  if (await evidenceEntryExists(evidenceDir, path.join(evidenceDir, entry.finalReceipt))) throw new AliasRunnerError("T-CRM final receipt must be sealed exactly once by U076 parent");
  const groups = []; for (const group of entry.groups) { const outputs = [];
    for (const relative of group.outputs) outputs.push(await checkedArtifact(evidenceDir, relative));
    const directCount = group.stepIds.filter((id) => id !== "crm-scope-pagination-browser").reduce((total, id) => total + stepResults.find((result) => result.id === id).testCount, 0);
    const browserCount = group.browserCasePartition === "customerCaseIds" ? customerCases.length : group.browserCasePartition === "opportunityCaseIds" ? opportunityCases.length : 0;
    if (directCount + browserCount <= 0) throw new AliasRunnerError(`T-CRM group ${group.id} has zero executed tests`);
    groups.push({ id: group.id, stepIds: group.stepIds, browserCasePartition: group.browserCasePartition, testCount: directCount + browserCount, outputs });
  }
  const expected = groups.flatMap((group) => group.outputs).filter((output) => !/^steps\/[^/]+\/result\.json$/.test(output.path)).sort((a, b) => a.path.localeCompare(b.path));
  const declared = stepResults.flatMap((result) => (result.declaredOutputs ?? []).map((output) => ({ ...output, stepId: result.id }))), credited = declared.map(({ stepId, ...output }) => output).sort((a, b) => a.path.localeCompare(b.path));
  const uniquelyOwned = declared.every(({ stepId, path: output }) => entry.groups.filter((group) => group.stepIds.includes(stepId) && group.outputs.includes(output)).length === 1);
  if (!uniquelyOwned || new Set(declared.map((output) => output.path)).size !== declared.length || !same(credited, expected)) throw new AliasRunnerError("T-CRM declared outputs must be exact, unique, and owned by one group");
  const closure = { owner: entry.owner, alias: entry.alias, executionOwnerUnit: entry.executionOwnerUnit, closureUnits: entry.closureUnits, manifestRowIds: entry.manifestRowIds, groups, stepResultHashes: await Promise.all(stepResults.map(async (result) => ({ id: result.id, sha256: hash(await readFile(path.join(evidenceDir, `steps/${result.id}/result.json`))) }))) };
  await atomicJson(evidenceDir, path.join(evidenceDir, "t-crm-closure.json"), closure, evidenceIdentity);
  return closure;
};

export const runTrackedSteps = async ({ entry, evidenceDir, evidenceIdentity, refs, mirrorContext, runtimeBase, spawnStep }) => {
  if (!path.isAbsolute(evidenceDir) || refs.ALIAS_EVIDENCE_DIR !== evidenceDir) throw new AliasRunnerError("alias evidence directory must be the verified absolute lease path");
  if (!SHA64.test(mirrorContext?.contextHash ?? "") || !SHA64.test(mirrorContext?.receiptHash ?? "")) throw new AliasRunnerError("mirror context and receipt hashes are required for step sealing");
  evidenceIdentity ??= await captureEvidenceIdentity(evidenceDir); await assertEvidenceIdentity(evidenceIdentity);
  const destinations = entry.steps.map((step) => path.join(evidenceDir, `steps/${step.id}/result.json`));
  if (entry.alias === "T-CRM") destinations.push(path.join(evidenceDir, "t-crm-closure.json"));
  if ((await Promise.all(destinations.map((target) => evidenceEntryExists(evidenceDir, target)))).some(Boolean)) throw new AliasRunnerError("fresh evidence requires every step and closure destination to be absent before spawn");
  let s9aReceiptFile;
  if (entry.alias === "T-OPS") {
    if (!same(entry.steps.map((step) => step.id), OPS_ORDER)) throw new AliasRunnerError("T-OPS tracked step order drift");
    if (Object.hasOwn(refs, "ALIAS_S9A_RECEIPT_FILE")) throw new AliasRunnerError("S9a receipt path must not be caller-provided");
    s9aReceiptFile = path.resolve(evidenceDir, "s9a/receipt.json");
    if (!inside(evidenceDir, s9aReceiptFile) || await evidenceEntryExists(evidenceDir, s9aReceiptFile)) throw new AliasRunnerError("S9a receipt must be absent and derived inside alias evidence");
  }
  const results = [];
  for (const step of entry.steps) {
    const reservation = await reserveJson(evidenceDir, path.join(evidenceDir, `steps/${step.id}/result.json`), evidenceIdentity);
    try {
    const consumer = entry.alias === "T-OPS" && ["tenant-restore-drill", "tenant-restore-contract"].includes(step.id);
    if (consumer) await validateS9aReceipt(s9aReceiptFile, refs, evidenceDir);
    const stepRefs = consumer ? { ...refs, ALIAS_S9A_RECEIPT_FILE: s9aReceiptFile } : refs;
    const environment = resolveStepEnvironment(step, stepRefs, runtimeBase), result = await spawnStep(step, environment);
    const machine = { framework: result.framework, testCount: result.testCount, skipped: result.skipped, fixme: result.fixme, todo: result.todo, only: result.only, retried: result.retried, outputs: result.outputPaths, cleanup: result.cleanup };
    if (result.exitCode !== 0 || result.signal !== null || !Number.isFinite(result.durationMs) || result.durationMs < 0 || !strictMachineResult(machine)) throw new AliasRunnerError(`${entry.alias}/${step.id} did not produce a strict nonzero-test PASS`);
    const declaredOutputs = []; for (const output of result.outputPaths) declaredOutputs.push(await checkedArtifact(evidenceDir, output));
    const caseTelemetry = step.id === "crm-scope-pagination-browser" ? Object.fromEntries(["customerCaseIds", "opportunityCaseIds", "executedCaseIds"].map((key) => [key, [...result.machineResult[key]]])) : null;
    const sealed = { id: step.id, finalCandidateSha: refs.FINAL_CANDIDATE_SHA, contextHash: mirrorContext.contextHash, receiptHash: mirrorContext.receiptHash, argv: step.argv, environmentKeys: Object.keys(environment).sort(), framework: result.framework, testCount: result.testCount, skipped: 0, fixme: 0, todo: 0, only: 0, retried: 0, exitCode: result.exitCode, signal: result.signal, durationMs: result.durationMs, stdout: result.stdout, stderr: result.stderr, declaredOutputs, machineResult: caseTelemetry, cleanup: result.cleanup };
    await sealJson(reservation, sealed);
    results.push(sealed);
    if (entry.alias === "T-OPS" && step.id === "fresh-s9a-final-candidate") await validateS9aReceipt(s9aReceiptFile, refs, evidenceDir);
    } finally { await reservation.file.close(); }
  }
  if (entry.alias === "T-CRM") await validateCrmClosure(entry, evidenceDir, results, evidenceIdentity);
  return results;
};

const spawnCommand = (invocation, cwd, environment) => new Promise((resolve, reject) => {
  const started = process.hrtime.bigint(), child = spawn(invocation.command, invocation.args, { cwd, env: environment, shell: invocation.shell, stdio: ["ignore", "pipe", "pipe"] }), stdout = [], stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk)); child.stderr.on("data", (chunk) => stderr.push(chunk)); child.once("error", reject);
  child.once("close", (exitCode, signal) => resolve({ exitCode, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), durationMs: Number(process.hrtime.bigint() - started) / 1e6 }));
});

const main = async () => {
  const alias = parseAliasArguments(process.argv.slice(2));
  if (typeof process.env.DETACHED_RELEASE_MIRROR_CONTEXT !== "string") throw new AliasRunnerError("DETACHED_RELEASE_MIRROR_CONTEXT is required");
  const declared = await validateMirrorArtifacts(JSON.parse(process.env.DETACHED_RELEASE_MIRROR_CONTEXT));
  const actualRoot = await realpath(process.cwd()), actualScript = await realpath(SCRIPT_PATH);
  const git = (args) => spawnSync("git", args, { cwd: actualRoot, encoding: "utf8", env: { PATH: process.env.PATH } });
  const head = git(["rev-parse", "HEAD"]), status = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const branch = git(["symbolic-ref", "--quiet", "HEAD"]), ignored = git(["ls-files", "--others", "--ignored", "--exclude-standard", "--", ".env*", "**/.env*"]);
  if (head.status !== 0 || status.status !== 0 || branch.status !== 1 || ignored.status !== 0 || [head, status, branch, ignored].some((result) => result.signal !== null || result.error)) throw new AliasRunnerError("Git mirror revalidation failed");
  if (actualRoot !== declared.mirrorRoot || actualScript !== declared.scriptPath) throw new AliasRunnerError("mirror context differs from actual detached root/script state");
  const envFiles = ignored.stdout.split("\n").filter((file) => path.basename(file).startsWith(".env")); validateMirrorContext({ ...declared, mirrorRoot: actualRoot, cwd: actualRoot, scriptPath: actualScript, headSha: head.stdout.trim(), status: status.stdout, envFiles });
  await validateRuntimeWrapper(actualRoot);
  if (process.env.FINAL_CANDIDATE_SHA !== declared.candidateSha) throw new AliasRunnerError("FINAL_CANDIDATE_SHA differs from mirror context");
  const aliases = JSON.parse(await readFile(path.join(actualRoot, "docs/12_VERIFICATION/test-alias-map.json"), "utf8"));
  const leaseMap = validateFinalAliasLeaseMap(JSON.parse(process.env.FINAL_ALIAS_LEASE_MAP ?? "null"), aliases);
  const evidenceIdentities = await validateLeasePathBoundaries(leaseMap);
  const entry = aliases.find((candidate) => candidate.alias === alias); if (!entry) throw new AliasRunnerError(`unknown alias ${alias}`);
  const lease = leaseMap[alias];
  const leaseReceipt = JSON.parse(await readFile(lease.leaseFile, "utf8"));
  if (!["runId", "ownerUnit", "webPort", "apiPort"].every((key) => leaseReceipt[key] === lease[key])) throw new AliasRunnerError("selected alias resource lease receipt mismatch");
  if (Object.hasOwn(process.env, "ALIAS_S9A_RECEIPT_FILE")) throw new AliasRunnerError("caller must not inject ALIAS_S9A_RECEIPT_FILE");
  const refs = { ALIAS_RUN_ID: lease.runId, ALIAS_WEB_PORT: String(lease.webPort), ALIAS_API_PORT: String(lease.apiPort), ALIAS_LEASE_FILE: lease.leaseFile, ALIAS_EVIDENCE_DIR: lease.evidenceDir, FINAL_CANDIDATE_SHA: declared.candidateSha };
  for (const name of new Set(entry.steps.flatMap((step) => Object.values(step.env).map((descriptor) => descriptor.from).filter(Boolean)))) if (!["ALIAS_S9A_RECEIPT_FILE", ...Object.keys(refs)].includes(name)) refs[name] = process.env[name];
  const runtimeBase = Object.fromEntries(RUNTIME_BASE_KEYS.map((key) => [key, process.env[key]]));
  const evidenceIdentity = evidenceIdentities.get(lease.evidenceDir);
  await runTrackedSteps({ entry, evidenceDir: lease.evidenceDir, evidenceIdentity, refs, mirrorContext: declared, runtimeBase, spawnStep: async (step, environment) => {
    const raw = await spawnCommand(buildStepInvocation(actualRoot, step), actualRoot, environment);
    const stepDir = path.join(lease.evidenceDir, `steps/${step.id}`);
    await assertEvidenceIdentity(evidenceIdentity);
    const stdoutFile = path.join(stepDir, "stdout.txt"), stderrFile = path.join(stepDir, "stderr.txt");
    await Promise.all([writeFile(stdoutFile, raw.stdout), writeFile(stderrFile, raw.stderr)]);
    const machineResult = parseMachineResult(raw.stdout, step.id === "crm-scope-pagination-browser" ? "crm-browser" : "base");
    return { ...raw, ...machineResult, outputPaths: machineResult.outputs, machineResult, stdout: { path: path.relative(lease.evidenceDir, stdoutFile), sha256: hash(raw.stdout), bytes: raw.stdout.length }, stderr: { path: path.relative(lease.evidenceDir, stderrFile), sha256: hash(raw.stderr), bytes: raw.stderr.length } };
  } });
};

if (path.resolve(process.argv[1] ?? "") === path.resolve(SCRIPT_PATH)) main().catch((error) => { // no-excuse-ok: catch — CLI boundary
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof AliasRunnerError ? 64 : 70;
});
