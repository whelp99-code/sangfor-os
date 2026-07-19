/**
 * U007 — single outer lifecycle owner for isolated Postgres + child argv after --.
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  withIsolatedPostgres,
  DEFAULT_LOCK,
} from "./lib/isolated-postgres.mjs";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));

function fail(code, msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const out = { migrate: false };
  /** @type {string[]} */
  let childArgv = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--") {
      childArgv = argv.slice(i + 1);
      break;
    }
    if (a === "--migrate") {
      out.migrate = true;
      i += 1;
      continue;
    }
    if (a === "--run-id") {
      out.runId = argv[++i];
    } else if (a === "--owner-unit") {
      out.ownerUnit = argv[++i];
    } else if (a === "--purpose") {
      out.purpose = argv[++i];
    } else if (a === "--image-digest") {
      out.imageDigest = argv[++i];
    } else if (a === "--evidence-dir") {
      out.evidenceDir = argv[++i];
    } else if (a === "--application-role-mode") {
      out.applicationRoleMode = argv[++i];
    } else {
      fail(64, `unknown arg: ${a}`);
    }
    i += 1;
  }
  return { out, childArgv };
}

function spawnChild(argv, env) {
  return new Promise((resolvePromise) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, {
      shell: false,
      env,
      stdio: "inherit",
    });
    const onSignal = (sig) => {
      try {
        child.kill(sig);
      } catch {
        // ignore
      }
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    child.on("close", (code, signal) => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      if (signal) {
        const map = { SIGINT: 2, SIGTERM: 15 };
        resolvePromise(128 + (map[signal] ?? 15));
      } else {
        resolvePromise(code ?? 1);
      }
    });
  });
}

export async function runWithIsolatedPostgresMain(argv = process.argv.slice(2)) {
  const { out, childArgv } = parseArgs(argv);
  if (!out.runId || !out.ownerUnit || !out.purpose || !out.imageDigest || !out.evidenceDir) {
    fail(
      64,
      "usage: run-with-isolated-postgres.mjs --run-id <id> --owner-unit <U> --purpose <p> --image-digest <d> --evidence-dir <dir> [--migrate] -- <cmd...>",
    );
  }
  if (!Array.isArray(childArgv) || childArgv.length === 0) {
    fail(64, "child argv after -- required (non-empty, no shell string)");
  }
  if (childArgv.some((a) => a === "-c" || a === "eval")) {
    fail(64, "shell -c/eval rejected");
  }

  // Ensure ambient DB URL does not leak into helper gate
  const savedDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  let primaryExit = 0;
  try {
    await withIsolatedPostgres(
      {
        runId: String(out.runId),
        ownerUnit: String(out.ownerUnit),
        purpose: String(out.purpose),
        imageDigest: String(out.imageDigest),
        evidenceDir: resolve(String(out.evidenceDir)),
        migrate: out.migrate === true,
        applicationRoleMode: out.applicationRoleMode
          ? String(out.applicationRoleMode)
          : "none",
      },
      async (ctx) => {
        const env = {
          ...process.env,
          DATABASE_URL: ctx.databaseUrl,
          TASK_OWNED_DATABASE_URL: ctx.taskOwnedDatabaseUrl,
          TASK_POSTGRES_RECEIPT_FILE: ctx.receiptPath,
        };
        primaryExit = await spawnChild(childArgv, env);
        if (primaryExit !== 0) {
          const err = new Error(`child exited ${primaryExit}`);
          err.exitCode = primaryExit >= 64 && primaryExit <= 67 ? primaryExit : primaryExit;
          throw err;
        }
      },
    );
  } catch (err) {
    const code =
      err && typeof err === "object" && "exitCode" in err
        ? Number(err.exitCode)
        : primaryExit || 65;
    if (savedDb !== undefined) process.env.DATABASE_URL = savedDb;
    process.exit(code);
  }
  if (savedDb !== undefined) process.env.DATABASE_URL = savedDb;
  process.exit(0);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runWithIsolatedPostgresMain().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(err?.exitCode ?? 65);
  });
}
