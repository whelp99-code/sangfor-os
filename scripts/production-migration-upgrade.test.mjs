import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(resolve(root, "scripts/fixtures/restore-drill/postgres16-image.lock.json"), "utf8"));
const image = lock.resolvedImage;

/** psql/pg_isready over the container's own TCP listener rather than the Unix
 *  socket. The official image starts a temporary server during initdb, shuts it
 *  down, then starts the real one; a socket probe can pass against that
 *  temporary server and the socket then vanishes for the restart, which failed
 *  this test twice in the release gate with
 *  `.s.PGSQL.5432: No such file or directory`. scripts/lib/isolated-postgres.mjs
 *  documents the same reasoning. */
const inContainer = (name, ...args) => ["docker", "exec", "-i", name, ...args, "-h", "127.0.0.1", "-U", "postgres"];

function run(argv, input) {
  const result = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", input, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  if (result.status !== 0) throw new Error(`${argv.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

test("upgrades an already-applied password credential migration", { timeout: 180_000 }, async () => {
  assert.equal(process.env.DOCKER_HOST, undefined);
  assert.equal(process.env.DOCKER_CONTEXT, undefined);
  const name = `sangfor-migration-upgrade-${process.pid}-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(24).toString("base64url");
  try {
    run(["docker", "run", "-d", "--name", name, "--label", "com.sangfor.refactor.unit=production-migration-upgrade", "-e", `POSTGRES_PASSWORD=${password}`, image]);
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const probe = spawnSync("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { encoding: "utf8" });
      if (probe.status === 0) { ready = true; break; }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
    assert.equal(ready, true, "PostgreSQL did not become ready");
    run(inContainer(name, "psql", "-v", "ON_ERROR_STOP=1"), 'CREATE TABLE "users" ("id" TEXT PRIMARY KEY);\n');
    run(inContainer(name, "psql", "-v", "ON_ERROR_STOP=1"), readFileSync(resolve(root, "packages/db/prisma/migrations/20260728143000_user_password_credentials/migration.sql"), "utf8"));
    assert.equal(run(inContainer(name, "psql", "-At", "-c", "SELECT count(*) FROM information_schema.columns WHERE table_name='user_credentials' AND column_name='credential_version'")), "0");
    run(inContainer(name, "psql", "-v", "ON_ERROR_STOP=1"), readFileSync(resolve(root, "packages/db/prisma/migrations/20260728190000_user_credential_version/migration.sql"), "utf8"));
    assert.equal(run(inContainer(name, "psql", "-At", "-c", "SELECT column_default || ':' || is_nullable FROM information_schema.columns WHERE table_name='user_credentials' AND column_name='credential_version'")), "1:NO");
    const invalid = spawnSync("docker", inContainer(name, "psql", "-v", "ON_ERROR_STOP=1", "-c", "INSERT INTO users(id) VALUES ('u1'); INSERT INTO user_credentials(user_id,password_digest,credential_version,updated_at) VALUES ('u1','$scrypt$v1$x',0,NOW());").slice(1), { encoding: "utf8" });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /user_credentials_version_check/u);
  } finally {
    spawnSync("docker", ["rm", "-f", name], { encoding: "utf8" });
  }
});
