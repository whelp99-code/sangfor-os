import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const REQUIREMENT_IDS = [
  ...Array.from({ length: 18 }, (_, index) => `REQ-M${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `REQ-S${index + 1}`),
];
const ACCEPTANCE_GROUPS = {
  SEC: 9, WF: 5, BIZ: 6, AI: 5, UX: 6, PERF: 6, DOD: 9,
  "V31-BIZOPS": 8, "V31-GOV": 6, "V31-AIQ": 5, "V31-AUTH": 6,
};
const ACCEPTANCE_IDS = Object.entries(ACCEPTANCE_GROUPS).flatMap(([prefix, count]) =>
  Array.from({ length: count }, (_, index) => `AC-${prefix}-${String(index + 1).padStart(2, "0")}`));
const ALL_IDS = [...REQUIREMENT_IDS, ...ACCEPTANCE_IDS];
const STATES = new Set(["AUTONOMOUS_LOCAL", "MANUAL_EXTERNAL_PENDING", "MANUAL_EXTERNAL_PASS"]);
const ROW_KEYS = ["closureUnit", "evidenceToken", "executionUnits", "id", "kind", "primaryOwner", "primaryTest", "source", "title", "verificationState"];
const ENTRY_KEYS = ["alias", "closureUnits", "executionOwnerUnit", "manifestRowIds", "owner", "runner", "steps"];
const STEP_KEYS = ["argv", "coversClosureUnits", "env", "id", "workspace"];
const EVIDENCE_KEYS = ["artifactHashes", "baselineSha", "closureUnit", "commands", "evidenceToken", "executionUnit", "manifestId", "primaryOwner", "schemaVersion", "verificationState", "workSha"];
const ENV_REFS = new Set(["ALIAS_API_PORT", "ALIAS_EVIDENCE_DIR", "ALIAS_LEASE_FILE", "ALIAS_RUN_ID", "ALIAS_S9A_RECEIPT_FILE", "ALIAS_WEB_PORT", "FINAL_CANDIDATE_SHA", "TASK_OWNED_DATABASE_URL", "TASK_POSTGRES_RECEIPT_FILE"]);
const ALIAS_MAP_DIGEST = "56c86cc8c3c936b35f7870c75c614a4f0b27fe7c10013c379edbb1a9945d2e55";
const EVIDENCE_SCHEMA_DIGEST = "ba1576b413faf2481c08ae76ca0d4337ae68b022eead570687f44f1aa6252941";
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const UNIT = /^U(?:00[1-9]|0[1-6][0-9]|07[0-6])$/;

class RegistryValidationError extends Error {}

const digest = (value) => createHash("sha256").update(value).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sortedUnique = (values) => [...new Set(values)].sort();
const parseJson = async (root, relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));
const add = (errors, condition, message) => { if (!condition) errors.push(message); };
const inside = (root, target) => { const relative = path.relative(root, target); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); };

const parseArgs = (argv) => {
  let root = process.cwd();
  let evidenceFile;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || !["--root", "--evidence"].includes(flag)) throw new RegistryValidationError("usage: check-requirement-registry.mjs [--root absolute-path] [--evidence absolute-path]");
    if (flag === "--root") root = path.resolve(value);
    if (flag === "--evidence") evidenceFile = path.resolve(value);
  }
  return { root, evidenceFile };
};

const parseSourceRows = (text, pattern, source, titleIndex) => {
  const rows = [];
  for (const [index, line] of text.split("\n").entries()) {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (pattern.test(cells[0] ?? "")) rows.push({ id: cells[0], title: cells[titleIndex], source, line: index + 1 });
  }
  return rows;
};

const parseTrace = (text, errors) => {
  const rows = new Map();
  for (const line of text.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (!/^(?:REQ-[MS]\d+|AC-[A-Z0-9-]+)$/.test(cells[0] ?? "")) continue;
    const closure = cells[4].match(/\/(U\d{3})\/attempt-/);
    add(errors, Boolean(closure), `${cells[0]} trace closure pointer missing`);
    rows.set(cells[0], { primaryOwner: cells[1], executionUnits: cells[2].split(","), closureUnit: closure?.[1], evidenceToken: cells[3], primaryTest: cells[3], verificationState: cells[4].split(/\s+—\s+/)[0] });
  }
  return rows;
};

const validateSnapshot = async (root, errors) => {
  const snapshot = await parseJson(root, "docs/planning/snapshots/manifest.json");
  const traceEntry = snapshot.files.find((entry) => entry.destination === "docs/planning/snapshots/traceability.md");
  const trace = await readFile(path.join(root, "docs/planning/snapshots/traceability.md"));
  add(errors, Boolean(traceEntry), "snapshot manifest traceability entry missing");
  add(errors, traceEntry?.bytes === trace.byteLength, "snapshot traceability byte count drift");
  add(errors, traceEntry?.sha256 === digest(trace), "snapshot traceability SHA-256 drift");
  return trace.toString("utf8");
};

const validateManifest = (rows, sources, trace, errors) => {
  add(errors, Array.isArray(rows), "acceptance manifest must be an array");
  if (!Array.isArray(rows)) return new Map();
  const positions = new Map();
  rows.forEach((row, index) => positions.set(row.id, [...(positions.get(row.id) ?? []), index + 1]));
  for (const [id, indexes] of positions) if (indexes.length > 1) errors.push(`duplicate ID ${id} at rows ${indexes.join(",")}`);
  for (const id of ALL_IDS) if (!positions.has(id)) errors.push(`missing manifest ID ${id}`);
  for (const row of rows) {
    if (/^REQ-[CW]/.test(row.id ?? "")) errors.push(`excluded ID ${row.id} is not part of the 99-row denominator`);
    add(errors, same(Object.keys(row).sort(), ROW_KEYS), `${row.id ?? "unknown"} row fields drift`);
    add(errors, typeof row.primaryOwner === "string" && row.primaryOwner.length > 0, `${row.id} primaryOwner is required`);
    add(errors, Array.isArray(row.executionUnits) && row.executionUnits.length > 0 && row.executionUnits.every((unit) => UNIT.test(unit)), `${row.id} executionUnits invalid`);
    add(errors, Array.isArray(row.executionUnits) && new Set(row.executionUnits).size === row.executionUnits.length, `${row.id} executionUnits contain duplicate units`);
    add(errors, typeof row.closureUnit === "string" && UNIT.test(row.closureUnit), `${row.id} closureUnit must be one unit string`);
    add(errors, Array.isArray(row.executionUnits) && row.executionUnits.includes(row.closureUnit), `${row.id} closureUnit must occur in executionUnits`);
    add(errors, STATES.has(row.verificationState), `${row.id} verificationState invalid`);
    add(errors, typeof row.source === "string" && row.source.length > 0, `${row.id} source is required`);
    const source = sources.get(row.id);
    const mapping = trace.get(row.id);
    add(errors, Boolean(source), `${row.id} missing from canonical source`);
    add(errors, Boolean(mapping), `${row.id} missing from tracked traceability snapshot`);
    if (source) add(errors, row.title === source.title && row.source === source.source, `${row.id} title/source drift`);
    if (mapping) for (const key of ["primaryOwner", "executionUnits", "closureUnit", "evidenceToken", "primaryTest", "verificationState"]) add(errors, same(row[key], mapping[key]), `${row.id} ${key} differs from tracked traceability`);
  }
  const manual = rows.filter((row) => row.verificationState !== "AUTONOMOUS_LOCAL");
  add(errors, manual.length === 1 && manual[0]?.id === "AC-DOD-09", "AC-DOD-09 must be the only manual-external row");
  const dod09 = rows.find((row) => row.id === "AC-DOD-09");
  add(errors, Boolean(dod09) && dod09.primaryOwner === "REL-01" && same(dod09.executionUnits, ["U076"]) && dod09.closureUnit === "U076" && dod09.evidenceToken === "T-REL" && dod09.verificationState === "MANUAL_EXTERNAL_PENDING", "AC-DOD-09 must remain REL-01/U076/T-REL/MANUAL_EXTERNAL_PENDING");
  return new Map(rows.map((row) => [row.id, row]));
};

const validateAliases = (text, errors) => {
  const mappings = new Map();
  const ids = [];
  for (const line of text.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (!/^(?:REQ-|AC-)/.test(cells[0] ?? "")) continue;
    ids.push(cells[0]);
    for (const alias of cells.slice(0, 3)) mappings.set(alias, [...(mappings.get(alias) ?? []), cells[0]]);
  }
  add(errors, same(ids, ALL_IDS), "canonical alias registry ID set/order drift");
  for (const [alias, idsForAlias] of mappings) if (new Set(idsForAlias).size > 1) errors.push(`alias ${alias} maps to ${sortedUnique(idsForAlias).join(",")}`);
};

const validateAliasMap = (entries, rowsById, errors) => {
  add(errors, Array.isArray(entries) && entries.length === 23, "test alias map must contain 23 entries");
  if (!Array.isArray(entries)) return;
  const owners = entries.map((entry) => entry.owner);
  const aliases = entries.map((entry) => entry.alias);
  add(errors, new Set(owners).size === 23, "test alias map owners must be unique");
  add(errors, new Set(aliases).size === 23, "test alias map aliases must be unique");
  const rowClaims = new Map();
  const stepClaims = new Map();
  for (const entry of entries) {
    const expectedKeys = entry.alias === "T-CRM" ? [...ENTRY_KEYS, "finalReceipt", "groups"].sort() : ENTRY_KEYS;
    add(errors, same(Object.keys(entry).sort(), expectedKeys), `${entry.alias} alias map fields drift`);
    add(errors, entry.runner === `bash scripts/run-workspace-runtime.sh root -- node scripts/run-test-alias.mjs --alias ${entry.alias}`, `${entry.alias} runner invalid`);
    add(errors, UNIT.test(entry.executionOwnerUnit), `${entry.alias} executionOwnerUnit invalid`);
    add(errors, same(entry.manifestRowIds, [...entry.manifestRowIds].sort()), `${entry.alias} manifestRowIds must be bytewise sorted`);
    for (const id of entry.manifestRowIds) rowClaims.set(id, [...(rowClaims.get(id) ?? []), entry.alias]);
    for (const step of entry.steps) {
      add(errors, same(Object.keys(step).sort(), STEP_KEYS), `${entry.alias}/${step.id} tracked step fields drift`);
      stepClaims.set(step.id, [...(stepClaims.get(step.id) ?? []), entry.alias]);
      add(errors, ["root", "workflow"].includes(step.workspace), `${entry.alias}/${step.id} workspace invalid`);
      add(errors, Array.isArray(step.argv) && step.argv.length > 0 && step.argv.every((value) => typeof value === "string" && value.length > 0), `${entry.alias}/${step.id} argv invalid`);
      const command = step.argv.join(" ");
      add(errors, !/run-test-alias\.mjs|(?:^| )-c(?: |$)|(?:^| )eval(?: |$)|pnpm --if-present|\|\| true/.test(command), `${entry.alias}/${step.id} argv contains a forbidden command`);
      for (const descriptor of Object.values(step.env)) {
        const keys = Object.keys(descriptor);
        add(errors, keys.length === 1 && ["literal", "from"].includes(keys[0]) && typeof descriptor[keys[0]] === "string" && descriptor[keys[0]].length > 0, `${entry.alias}/${step.id} env descriptor invalid`);
        if (keys[0] === "from") add(errors, ENV_REFS.has(descriptor.from), `${entry.alias}/${step.id} env ref unknown`);
      }
    }
    const assigned = [...rowsById.values()].filter((row) => row.primaryOwner === entry.owner);
    add(errors, same(entry.manifestRowIds, assigned.map((row) => row.id).sort()), `${entry.alias} manifestRowIds do not equal owner partition`);
    add(errors, same(entry.closureUnits, sortedUnique(assigned.map((row) => row.closureUnit))), `${entry.alias} closureUnits do not equal assigned rows`);
    add(errors, same(sortedUnique(entry.steps.flatMap((step) => step.coversClosureUnits)), entry.closureUnits), `${entry.alias} tracked step closure coverage differs`);
  }
  for (const [id, row] of rowsById) {
    add(errors, same(rowClaims.get(id), [row.primaryTest]), `${id} primaryTest/manifestRowIds partition mismatch`);
    const entry = entries.find((candidate) => candidate.alias === row.primaryTest);
    add(errors, entry?.owner === row.primaryOwner, `${id} primaryTest does not map to primaryOwner`);
  }
  for (const [id, claims] of stepClaims) if (claims.length > 1) errors.push(`tracked step ${id} is duplicated by ${claims.join(",")}`);
  add(errors, stepClaims.size === 63, "alias map tracked step count must be 63");
  add(errors, entries.find((entry) => entry.alias === "T-CRM")?.steps.length === 10 && entries.filter((entry) => entry.alias !== "T-CRM").flatMap((entry) => entry.steps).length === 53, "alias map tracked step split must be 53 non-CRM + 10 T-CRM");
  add(errors, digest(JSON.stringify(entries)) === ALIAS_MAP_DIGEST, "alias map exact semantic digest drift");
};

const validateEvidence = async (file, rowsById, errors) => {
  if (!file) return;
  let evidenceRoot;
  try {
    const metadata = await lstat(file);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("receipt must be a regular non-symlink file");
    evidenceRoot = await realpath(path.dirname(file));
  } catch (error) { errors.push(`evidence receipt physical root invalid: ${error instanceof Error ? error.message : String(error)}`); return; }
  const receipt = JSON.parse(await readFile(file, "utf8"));
  const row = rowsById.get(receipt.manifestId);
  add(errors, same(Object.keys(receipt).sort(), EVIDENCE_KEYS), "evidence receipt fields differ from schema");
  add(errors, receipt.schemaVersion === 1 && SHA40.test(receipt.baselineSha ?? "") && SHA40.test(receipt.workSha ?? ""), "evidence schemaVersion/baselineSha/workSha invalid");
  add(errors, Array.isArray(receipt.commands) && receipt.commands.length > 0 && receipt.commands.every((command) => same(Object.keys(command).sort(), ["argv", "exitCode", "testCount"]) && Array.isArray(command.argv) && command.argv.length > 0 && command.argv.every((value) => typeof value === "string" && value.length > 0) && command.exitCode === 0 && Number.isInteger(command.testCount) && command.testCount > 0), "evidence commands must prove successful nonzero-test execution");
  add(errors, Array.isArray(receipt.artifactHashes) && receipt.artifactHashes.length > 0 && receipt.artifactHashes.every((artifact) => same(Object.keys(artifact).sort(), ["bytes", "path", "sha256"]) && typeof artifact.path === "string" && artifact.path.length > 0 && SHA64.test(artifact.sha256 ?? "") && Number.isInteger(artifact.bytes) && artifact.bytes > 0), "evidence artifact hashes invalid");
  if (Array.isArray(receipt.artifactHashes)) {
    const paths = receipt.artifactHashes.map((artifact) => artifact.path);
    add(errors, paths.every((value, index) => paths.indexOf(value) === index), "evidence artifact paths must be unique");
    for (const artifact of receipt.artifactHashes) try {
      if (typeof artifact.path !== "string" || path.isAbsolute(artifact.path) || path.normalize(artifact.path) !== artifact.path) throw new Error("path must be normalized and relative");
      const target = path.resolve(evidenceRoot, artifact.path);
      if (!inside(evidenceRoot, target)) throw new Error("path escapes evidence root");
      const metadata = await lstat(target), physical = await realpath(target);
      if (metadata.isSymbolicLink() || !metadata.isFile() || physical !== target || !inside(evidenceRoot, physical)) throw new Error("path is not a contained regular non-symlink file");
      const bytes = await readFile(target);
      if (bytes.length !== artifact.bytes || digest(bytes) !== artifact.sha256) throw new Error("bytes or SHA-256 mismatch");
    } catch (error) { errors.push(`evidence artifact ${artifact?.path ?? "unknown"} invalid: ${error instanceof Error ? error.message : String(error)}`); }
  }
  add(errors, STATES.has(receipt.verificationState), "evidence verificationState invalid");
  add(errors, Boolean(row), `evidence manifestId ${receipt.manifestId} is unknown`);
  if (!row) return;
  for (const field of ["primaryOwner", "closureUnit", "evidenceToken"]) add(errors, receipt[field] === row[field], `evidence ${field} differs from manifest`);
  add(errors, receipt.verificationState === row.verificationState || (row.id === "AC-DOD-09" && receipt.verificationState === "MANUAL_EXTERNAL_PASS"), "evidence verificationState transition invalid");
  add(errors, row.executionUnits.includes(receipt.executionUnit), "evidence executionUnit differs from manifest");
};

const main = async () => {
  const { root, evidenceFile } = parseArgs(process.argv.slice(2));
  const errors = [];
  const reqFile = "docs/01_SPEC/Requirements_MoSCoW.md";
  const acFile = "docs/08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md";
  const sourceRows = [
    ...parseSourceRows(await readFile(path.join(root, reqFile), "utf8"), /^REQ-[MS]\d+$/, reqFile, 3),
    ...parseSourceRows(await readFile(path.join(root, acFile), "utf8"), /^AC-[A-Z0-9-]+$/, acFile, 1),
  ];
  const sourcePositions = new Map();
  for (const row of sourceRows) sourcePositions.set(row.id, [...(sourcePositions.get(row.id) ?? []), `${row.source}:${row.line}`]);
  for (const [id, positions] of sourcePositions) if (positions.length > 1) errors.push(`duplicate canonical source ID ${id} at ${positions.join(",")}`);
  add(errors, same(sourceRows.map((row) => row.id), ALL_IDS), "canonical source exact ID set/order drift");
  const sources = new Map(sourceRows.map(({ id, title, source }) => [id, { title, source }]));
  const trace = parseTrace(await validateSnapshot(root, errors), errors);
  const rows = await parseJson(root, "docs/12_VERIFICATION/acceptance-manifest.json");
  const rowsById = validateManifest(rows, sources, trace, errors);
  validateAliases(await readFile(path.join(root, "docs/01_SPEC/Requirement_ID_Registry.md"), "utf8"), errors);
  const schema = await parseJson(root, "docs/12_VERIFICATION/acceptance-evidence.schema.json");
  add(errors, digest(JSON.stringify(schema)) === EVIDENCE_SCHEMA_DIGEST, "evidence schema exact semantic digest drift");
  validateAliasMap(await parseJson(root, "docs/12_VERIFICATION/test-alias-map.json"), rowsById, errors);
  await validateEvidence(evidenceFile, rowsById, errors);
  if (errors.length > 0) throw new RegistryValidationError(errors.map((error) => `REGISTRY_CHECK FAIL: ${error}`).join("\n"));
  console.log(`requirements=28 acceptance=71 registry=99 testAliases=23 categories=${Object.entries(ACCEPTANCE_GROUPS).map(([key, value]) => `${key}:${value}`).join(",")}`);
  console.log("excluded=C1-C5,W1-W5 manualExternal=AC-DOD-09 closureUnits=99 trackedSteps=63 nonCrmSteps=53 crmSteps=10");
};

main().catch((error) => { // no-excuse-ok: catch — CLI boundary
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof RegistryValidationError ? 1 : 70;
});
