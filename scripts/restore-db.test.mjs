import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const QUARANTINE_CODE = "DIRECT_RESTORE_QUARANTINED_USE_U009";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, "..");
const shellRestore = resolve(rootDirectory, "scripts/restore-db.sh");
const typedRestore = resolve(rootDirectory, "packages/db/scripts/cfo-restore.ts");
const tsxBinary = resolve(rootDirectory, "packages/db/node_modules/.bin/tsx");

const inputClasses = [
  ["loopback scratch", "postgresql://scratch:scratch@127.0.0.1:6543/u002_scratch"],
  ["production-looking", "postgresql://operator:secret@db.production.example:5432/finance"],
  ["current compose", "postgresql://ai_portal:ai_portal@localhost:5434/ai_automation_portal"],
  ["empty", ""],
];

function createSpyFixture() {
  const directory = mkdtempSync(join(tmpdir(), "u002-restore-"));
  const binDirectory = join(directory, "bin");
  const invocationFile = join(directory, "child-invocations.txt");
  const backupFile = join(directory, "fixture.sql");
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(backupFile, "SELECT 1;\n", "utf8");
  for (const command of ["psql", "docker"]) {
    const path = join(binDirectory, command);
    writeFileSync(
      path,
      `#!/usr/bin/env bash\nprintf '%s\\n' '${command}' >> '${invocationFile}'\nexit 97\n`,
      "utf8",
    );
    chmodSync(path, 0o755);
  }
  return { directory, binDirectory, invocationFile, backupFile };
}

function assertQuarantined(result, fixture) {
  assert.equal(result.status, 64);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `${QUARANTINE_CODE}\n`);
  let childInvocations = "";
  try {
    childInvocations = readFileSync(fixture.invocationFile, "utf8");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ENOENT")) throw error;
  }
  assert.equal(childInvocations, "");
}

test("root manifest removes only the direct cfo restore command", () => {
  // Given: the root workspace manifest.
  const manifest = JSON.parse(readFileSync(resolve(rootDirectory, "package.json"), "utf8"));

  // When: its scripts are inspected.
  const scripts = manifest.scripts;

  // Then: the direct restore alias is absent while snapshot remains.
  assert.equal(Object.hasOwn(scripts, "cfo:restore"), false);
  assert.equal(scripts["cfo:snapshot"], "pnpm --filter @sangfor/db cfo:snapshot");
});

test("DB package manifest still reaches the quarantined tombstone", () => {
  // Given: the read-only DB package manifest.
  const manifest = JSON.parse(
    readFileSync(resolve(rootDirectory, "packages/db/package.json"), "utf8"),
  );

  // When: the remaining restore command is inspected.
  const restoreCommand = manifest.scripts["cfo:restore"];

  // Then: it still targets the tombstoned TypeScript entrypoint.
  assert.equal(restoreCommand, "tsx scripts/cfo-restore.ts");
});

for (const [label, databaseUrl] of inputClasses) {
  test(`shell restore refuses ${label} input before child processes`, () => {
    // Given: the shell tombstone source and one URL input class.
    const source = readFileSync(shellRestore, "utf8");
    assert.match(source, /^#!\/usr\/bin\/env bash\n(?:printf|echo)/);
    const fixture = createSpyFixture();
    try {
      // When: the legacy shell restore entrypoint is invoked.
      const result = spawnSync("/bin/bash", [shellRestore, fixture.backupFile], {
        cwd: fixture.directory,
        env: {
          PATH: `${fixture.binDirectory}:${dirname(process.execPath)}:/usr/bin:/bin`,
          DATABASE_URL: databaseUrl,
        },
        encoding: "utf8",
      });

      // Then: it exits with the exact tombstone and invokes no DB child.
      assertQuarantined(result, fixture);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  test(`DB-package restore refuses ${label} input before child processes`, () => {
    // Given: the no-import TypeScript tombstone and one URL input class.
    const source = readFileSync(typedRestore, "utf8");
    assert.doesNotMatch(source, /^import\s/m);
    assert.match(source, /^process\.stderr\.write/);
    const fixture = createSpyFixture();
    try {
      // When: the DB package command target is invoked through its tsx runtime.
      const result = spawnSync(tsxBinary, [typedRestore, fixture.backupFile], {
        cwd: fixture.directory,
        env: {
          PATH: `${fixture.binDirectory}:${dirname(process.execPath)}:/usr/bin:/bin`,
          DATABASE_URL: databaseUrl,
        },
        encoding: "utf8",
      });

      // Then: it exits with the exact tombstone and invokes no DB child.
      assertQuarantined(result, fixture);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
}
