import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_MARKER = "docs/skills/skill-catalog.json";

export function getRepoRoot() {
  const starts = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../"),
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
  ];

  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 10; depth += 1) {
      if (fs.existsSync(path.join(dir, REPO_MARKER))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
}
