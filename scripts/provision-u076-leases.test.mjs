import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

import { buildLeaseMap } from "./provision-u076-leases.mjs";
import { validateEvidenceBoundary } from "./perf-smoke.mjs";
import { validateFinalAliasLeaseMap } from "./run-test-alias.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const aliases = JSON.parse(readFileSync(join(ROOT, "docs/12_VERIFICATION/test-alias-map.json"), "utf8"));
const RUN_ROOT = "/Users/someone/.local/share/sangfor-u076-abcd1234-20260101T000000Z";
const RUN_ID = "u076-main-1785690680457";
const PORTS = Array.from({ length: aliases.length * 2 }, (_, index) => 40000 + index);

const { leaseMap } = buildLeaseMap({ aliases, runRoot: RUN_ROOT, runId: RUN_ID, aliasPorts: PORTS });

describe("buildLeaseMap", () => {
  it("produces a map the alias runner accepts unchanged", () => {
    assert.deepEqual(validateFinalAliasLeaseMap(leaseMap, aliases), leaseMap);
  });

  it("satisfies the layout perf-smoke recomputes for T-PERF", () => {
    // perf-smoke derives the attempt root from the lease file and demands the
    // evidence directory sit at <root>/aliases/T-PERF beside <root>/leases.
    // Getting this wrong fails the campaign 22 aliases in, an hour from the start.
    const perf = leaseMap["T-PERF"];
    assert.doesNotThrow(() => validateEvidenceBoundary(perf.evidenceDir, perf.leaseFile));
    assert.equal(basename(perf.evidenceDir), "T-PERF");
    assert.equal(basename(dirname(perf.evidenceDir)), "aliases");
    assert.equal(basename(dirname(perf.leaseFile)), "leases");
    assert.equal(dirname(dirname(perf.evidenceDir)), dirname(dirname(perf.leaseFile)));
  });

  it("keeps every alias in the same shape, so the T-PERF rule is not a special case", () => {
    for (const [alias, lease] of Object.entries(leaseMap)) {
      assert.equal(basename(lease.evidenceDir), alias);
      assert.equal(basename(dirname(lease.evidenceDir)), "aliases");
      assert.equal(basename(lease.leaseFile), `${alias}.json`);
      assert.equal(basename(dirname(lease.leaseFile)), "leases");
    }
  });

  it("carries the owner unit the runner cross-checks against the alias map", () => {
    for (const entry of aliases) {
      assert.equal(leaseMap[entry.alias].ownerUnit, entry.executionOwnerUnit);
    }
  });

  it("gives every alias a distinct run id and port pair", () => {
    const runIds = new Set(Object.values(leaseMap).map((lease) => lease.runId));
    const ports = Object.values(leaseMap).flatMap((lease) => [lease.webPort, lease.apiPort]);
    assert.equal(runIds.size, aliases.length);
    assert.equal(new Set(ports).size, ports.length);
  });

  it("derives paths purely from its inputs, with no ambient state", () => {
    const again = buildLeaseMap({ aliases, runRoot: RUN_ROOT, runId: RUN_ID, aliasPorts: PORTS }).leaseMap;
    assert.deepEqual(again, leaseMap);
    const elsewhere = buildLeaseMap({ aliases, runRoot: "/tmp/other", runId: RUN_ID, aliasPorts: PORTS }).leaseMap;
    assert.equal(elsewhere["T-PERF"].evidenceDir, "/tmp/other/aliases/T-PERF");
  });
});
