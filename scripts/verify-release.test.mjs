import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { validateManifestSemantics } from "./verify-release.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, "release-gate.manifest.json");
const SCHEMA = join(HERE, "release-gate.manifest.schema.json");
const SCRIPT = join(HERE, "verify-release.mjs");

describe("verify-release", () => {
  it("tracked manifest has exact 15 steps and passes semantics", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    assert.equal(manifest.steps.length, 15);
    assert.doesNotThrow(() => validateManifestSemantics(manifest));
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ["schemaVersion", "steps"]);
  });

  it("rejects trailing argv and --scope", () => {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, "--manifest", MANIFEST, "--scope", "root"],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 64);
    const r2 = spawnSync(
      process.execPath,
      [SCRIPT, "--manifest", MANIFEST, "extra"],
      { encoding: "utf8" },
    );
    assert.equal(r2.status, 64);
  });

  it("rejects mutated step order", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    const tmp = structuredClone(manifest);
    const a = tmp.steps[0];
    tmp.steps[0] = tmp.steps[1];
    tmp.steps[1] = a;
    assert.throws(() => validateManifestSemantics(tmp), /order/);
  });

  it("rejects shell tokens and empty argv", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
    const tmp = structuredClone(manifest);
    tmp.steps[0].argv = ["bash", "-c", "echo hi"];
    assert.throws(() => validateManifestSemantics(tmp), /forbidden|argv/);
  });
});
