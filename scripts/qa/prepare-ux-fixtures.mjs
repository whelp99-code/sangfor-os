import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  disconnectUxFixtureDatabase,
  prepareUxFixtures,
} from "./prepare-ux-fixtures.ts";

export * from "./prepare-ux-fixtures.ts";

export async function main() {
  try {
    const result = await prepareUxFixtures();
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } finally {
    await disconnectUxFixtureDatabase();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entrypoint === import.meta.url) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = typeof error === "object" && error && "exitCode" in error
      ? Number(error.exitCode)
      : 1;
  });
}
