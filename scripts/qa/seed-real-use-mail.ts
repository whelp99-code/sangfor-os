import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export {
  assertTaskOwnedSeedEnvironment,
  seedRealUseMail,
} from "./seed-real-use-mail.mjs";

import { seedRealUseMail } from "./seed-real-use-mail.mjs";

function isDirectEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const absolute = resolve(entry);
    if (pathToFileURL(absolute).href === import.meta.url) return true;
    return absolute.endsWith("/seed-real-use-mail.ts")
      || absolute.endsWith("\\seed-real-use-mail.ts");
  } catch {
    return false;
  }
}

if (isDirectEntrypoint()) {
  seedRealUseMail().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    const code = typeof error === "object" && error && "exitCode" in error
      ? Number((error as { exitCode: number }).exitCode)
      : 1;
    process.exit(Number.isInteger(code) && code > 0 ? code : 1);
  });
}
