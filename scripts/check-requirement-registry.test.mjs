import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp as createTempRoot, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKER = path.join(REPO_ROOT, "scripts/check-requirement-registry.mjs");
const ownedRoots = new Set(), mkdtemp = async (prefix) => { const root = await createTempRoot(prefix); ownedRoots.add(root); return root; };
test.after(async () => { for (const root of ownedRoots) await rm(root, { recursive: true, force: true }); });
const FILES = [
  "docs/01_SPEC/Requirements_MoSCoW.md",
  "docs/01_SPEC/Requirement_ID_Registry.md",
  "docs/08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md",
  "docs/12_VERIFICATION/acceptance-manifest.json",
  "docs/12_VERIFICATION/acceptance-evidence.schema.json",
  "docs/12_VERIFICATION/test-alias-map.json",
  "docs/planning/snapshots/manifest.json",
  "docs/planning/snapshots/traceability.md",
];

const runChecker = (root, evidenceFile) => {
  const args = [CHECKER, "--root", root];
  if (evidenceFile) args.push("--evidence", evidenceFile);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
};

const outputOf = (result) => `${result.stdout}\n${result.stderr}`;
const ARTIFACT_BYTES = Buffer.from("registry-check\n");
const ARTIFACT_SHA = createHash("sha256").update(ARTIFACT_BYTES).digest("hex");

const makeFixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "u001-registry-"));
  for (const relative of FILES) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(REPO_ROOT, relative), target);
  }
  return root;
};

const mutateJson = async (root, relative, mutate) => {
  const target = path.join(root, relative);
  const value = JSON.parse(await readFile(target, "utf8"));
  mutate(value);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
};

const manifestRow = (rows, id) => {
  const row = rows.find((candidate) => candidate.id === id);
  assert.ok(row, `fixture row ${id} must exist`);
  return row;
};

const expectFailure = async (mutate, pattern = /REGISTRY_CHECK FAIL/) => {
  const root = await makeFixture();
  await mutate(root);
  const result = runChecker(root);
  assert.notEqual(result.status, 0, outputOf(result));
  assert.match(outputOf(result), pattern);
};

const writeReceiptFixture = async (root, value) => {
  const evidenceDir = path.join(root, "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const artifact = path.resolve(evidenceDir, value.artifactHashes[0].path);
  await mkdir(path.dirname(artifact), { recursive: true });
  await writeFile(artifact, ARTIFACT_BYTES);
  const file = path.join(evidenceDir, "receipt.json");
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return { file, artifact, evidenceDir };
};

test("canonical sources expose exactly 28 requirement and 71 acceptance IDs", async () => {
  // Given
  const requirements = await readFile(path.join(REPO_ROOT, FILES[0]), "utf8");
  const acceptance = await readFile(path.join(REPO_ROOT, FILES[2]), "utf8");
  // When
  const requirementIds = [...requirements.matchAll(/\| (REQ-[MS]\d+) \|/g)].map((match) => match[1]);
  const acceptanceIds = [...acceptance.matchAll(/\| (AC-[A-Z0-9-]+) \|/g)].map((match) => match[1]);
  // Then
  assert.equal(requirementIds.length, 28);
  assert.equal(acceptanceIds.length, 71);
  assert.equal(new Set(requirementIds).size, requirementIds.length);
  assert.equal(new Set(acceptanceIds).size, acceptanceIds.length);
});

test("canonical registry prints the literal closure counts", async () => {
  // Given
  const root = await makeFixture();
  // When
  const result = runChecker(root);
  // Then
  assert.equal(result.status, 0, outputOf(result));
  assert.match(result.stdout, /requirements=28 acceptance=71 registry=99 testAliases=23/);
  assert.match(result.stdout, /excluded=C1-C5,W1-W5 manualExternal=AC-DOD-09 closureUnits=99/);
});

test("exact-set mutations fail with actionable IDs and positions", async (context) => {
  await context.test("duplicate canonical source row", () => expectFailure(async (root) => {
    const target = path.join(root, FILES[0]);
    const text = await readFile(target, "utf8");
    const row = text.split("\n").find((line) => line.startsWith("| REQ-M1 |"));
    await writeFile(target, text.replace(row, `${row}\n${row}`));
  }, /duplicate canonical source ID REQ-M1/));
  await context.test("missing ID", () => expectFailure(async (root) => {
    await mutateJson(root, FILES[3], (rows) => rows.splice(rows.findIndex((row) => row.id === "REQ-M1"), 1));
  }, /missing manifest ID REQ-M1/));
  await context.test("duplicate ID", () => expectFailure(async (root) => {
    await mutateJson(root, FILES[3], (rows) => rows.splice(1, 0, { ...rows[0] }));
  }, /duplicate ID REQ-M1 at rows 1,2/));
  for (const excluded of ["REQ-C1", "REQ-W1"]) {
    await context.test(`excluded ${excluded}`, () => expectFailure(async (root) => {
      await mutateJson(root, FILES[3], (rows) => rows.push({ ...rows[0], id: excluded }));
    }, new RegExp(`excluded ID ${excluded}`)));
  }
});

test("row ownership, execution, closure, and state mutations fail", async (context) => {
  const cases = [
    ["missing owner", (row) => delete row.primaryOwner, /primaryOwner/],
    ["duplicate execution unit", (row) => row.executionUnits.push(row.executionUnits[0]), /executionUnits.*duplicate/],
    ["zero closure", (row) => { row.closureUnit = []; }, /closureUnit/],
    ["two closures", (row) => { row.closureUnit = ["U001", "U002"]; }, /closureUnit/],
    ["closure outside execution", (row) => { row.closureUnit = "U076"; }, /closureUnit.*executionUnits/],
    ["unknown state", (row) => { row.verificationState = "PASS"; }, /verificationState/],
  ];
  for (const [name, mutate, pattern] of cases) {
    await context.test(name, () => expectFailure(async (root) => {
      await mutateJson(root, FILES[3], (rows) => mutate(manifestRow(rows, "AC-DOD-08")));
    }, pattern));
  }
});

test("AC-DOD-09 is the only exact manual-external row", async (context) => {
  const cases = [
    ["owner", (row) => { row.primaryOwner = "DOC-01"; }],
    ["execution", (row) => { row.executionUnits = ["U001"]; }],
    ["closure", (row) => { row.closureUnit = "U001"; }],
    ["token", (row) => { row.evidenceToken = "T-DOC"; }],
    ["state", (row) => { row.verificationState = "MANUAL_EXTERNAL_PASS"; }],
  ];
  for (const [name, mutate] of cases) {
    await context.test(name, () => expectFailure(async (root) => {
      await mutateJson(root, FILES[3], (rows) => mutate(manifestRow(rows, "AC-DOD-09")));
    }, /AC-DOD-09/));
  }
});

test("legacy aliases and evidence receipts cannot disagree with the manifest", async (context) => {
  await context.test("duplicate legacy alias", () => expectFailure(async (root) => {
    const target = path.join(root, FILES[1]);
    const registry = await readFile(target, "utf8");
    await writeFile(target, registry.replace("legacy:req:M2", "legacy:req:M1"));
  }, /alias legacy:req:M1 maps to/));

  const receipt = {
    schemaVersion: 1,
    manifestId: "AC-DOD-08",
    baselineSha: "a".repeat(40),
    workSha: "b".repeat(40),
    primaryOwner: "DOC-01",
    executionUnit: "U001",
    closureUnit: "U001",
    evidenceToken: "T-DOC",
    commands: [{ argv: ["node", "scripts/check-requirement-registry.mjs"], exitCode: 0, testCount: 1 }],
    artifactHashes: [{ path: "registry-check.txt", sha256: ARTIFACT_SHA, bytes: ARTIFACT_BYTES.length }],
    verificationState: "AUTONOMOUS_LOCAL",
  };
  for (const [name, mutate, pattern] of [
    ["closure mismatch", (value) => { value.closureUnit = "U076"; }, /evidence closureUnit/],
    ["token mismatch", (value) => { value.evidenceToken = "T-REL"; }, /evidence evidenceToken/],
    ["failed command", (value) => { value.commands[0].exitCode = 1; }, /evidence commands/],
    ["zero tests", (value) => { value.commands[0].testCount = 0; }, /evidence commands/],
  ]) {
    await context.test(name, async () => {
      const root = await makeFixture();
      const value = structuredClone(receipt);
      mutate(value);
      const { file } = await writeReceiptFixture(root, value);
      const result = runChecker(root, file);
      assert.notEqual(result.status, 0, outputOf(result));
      assert.match(outputOf(result), pattern);
    });
  }

  for (const [name, mutate] of [
    ["missing artifact", async ({ artifact }) => rm(artifact)],
    ["tampered artifact", async ({ artifact }) => writeFile(artifact, "tampered\n")],
    ["symlinked artifact", async ({ artifact, evidenceDir }) => { const outside = path.join(path.dirname(evidenceDir), "outside.txt"); await rm(artifact); await writeFile(outside, ARTIFACT_BYTES); await symlink(outside, artifact); }],
    ["escaped artifact", async ({ value }) => { value.artifactHashes[0].path = "../outside.txt"; }],
    ["duplicate artifact", async ({ value }) => { value.artifactHashes.push({ ...value.artifactHashes[0] }); }],
  ]) await context.test(name, async () => {
    const root = await makeFixture();
    const value = structuredClone(receipt);
    if (name.includes("escaped") || name.includes("duplicate")) await mutate({ value });
    const fixture = await writeReceiptFixture(root, value);
    if (!name.includes("escaped") && !name.includes("duplicate")) await mutate(fixture);
    const result = runChecker(root, fixture.file);
    assert.notEqual(result.status, 0, outputOf(result));
    assert.match(outputOf(result), /evidence artifact/);
  });
});

test("alias partitions and exact tracked commands fail closed", async (context) => {
  const aliasCases = [
    ["missing entry", (entries) => entries.pop()],
    ["duplicate owner", (entries) => { entries[1].owner = entries[0].owner; }],
    ["missing owner", (entries) => { delete entries[0].owner; }],
    ["duplicate alias", (entries) => { entries[1].alias = entries[0].alias; }],
    ["empty runner", (entries) => { entries[0].runner = ""; }],
    ["foreign manifest row", (entries) => { entries[0].manifestRowIds = ["REQ-M1"]; }],
    ["closure subset", (entries) => { entries.find((entry) => entry.alias === "T-QTE").closureUnits.pop(); }],
    ["closure superset", (entries) => { entries[0].closureUnits.push("U076"); }],
    ["T-UX DB receipt removed", (entries) => {
      const entry = entries.find((candidate) => candidate.alias === "T-UX");
      delete entry.steps[0].env.TASK_POSTGRES_RECEIPT_FILE;
    }],
    ["T-SEC-AUTH boundary removed", (entries) => {
      const entry = entries.find((candidate) => candidate.alias === "T-SEC-AUTH");
      entry.steps[1].argv = entry.steps[1].argv.filter((value) => !value.includes("auth/login"));
    }],
    ["T-SEC-RBAC contract replaced", (entries) => {
      const entry = entries.find((candidate) => candidate.alias === "T-SEC-RBAC");
      entry.steps.find((step) => step.id === "business-role-contract").argv = ["node", "receipt-from-T-REL"];
    }],
    ["T-AUD contract removed", (entries) => {
      const entry = entries.find((candidate) => candidate.alias === "T-AUD");
      entry.steps = entry.steps.filter((step) => step.id !== "audit-chain-contract");
    }],
    ["recursive argv", (entries) => { entries[0].steps[0].argv = ["node", "scripts/run-test-alias.mjs"]; }],
    ["shell command", (entries) => { entries[0].steps[0].argv = ["sh", "-c", "true"]; }],
    ["duplicate step", (entries) => { entries[1].steps[0].id = entries[0].steps[0].id; }],
    ["T-OPS producer receipt ref exposed", (entries) => {
      const entry = entries.find((candidate) => candidate.alias === "T-OPS");
      entry.steps[0].env.S9A_RECEIPT_FILE = { from: "ALIAS_S9A_RECEIPT_FILE" };
    }],
    ["T-OPS producer reordered", (entries) => {
      const entry = entries.find((candidate) => candidate.alias === "T-OPS");
      [entry.steps[0], entry.steps[1]] = [entry.steps[1], entry.steps[0]];
    }],
  ];
  for (const [name, mutate] of aliasCases) {
    await context.test(name, () => expectFailure(async (root) => {
      await mutateJson(root, FILES[5], mutate);
    }, /alias map|test alias|tracked step|T-(?:UX|SEC|AUD)|manifestRowIds|closureUnits|argv/));
  }
  await context.test("manifest primaryTest drift", () => expectFailure(async (root) => {
    await mutateJson(root, FILES[3], (rows) => { manifestRow(rows, "REQ-M1").primaryTest = "T-REL"; });
  }, /primaryTest/));
});

test("evidence schema drift is rejected", () => expectFailure(async (root) => {
  await mutateJson(root, FILES[4], (schema) => schema.required.pop());
}, /evidence schema/));
