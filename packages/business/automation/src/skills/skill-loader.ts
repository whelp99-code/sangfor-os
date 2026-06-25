import fs from "node:fs";
import path from "node:path";

import { skillFolderNameFromCatalog } from "./execution-profile";
import { getSkillCatalogEntry } from "./skill-catalog";
import { getRepoRoot } from "./repo-root";

export function resolveSkillMarkdownPath(skillKey: string): string | null {
  const entry = getSkillCatalogEntry(skillKey);
  if (!entry) return null;

  const root = getRepoRoot();
  const folder = entry.source === "pm" ? "pm" : "aios";
  const skillDir = skillFolderNameFromCatalog(entry);
  const primary = path.join(root, ".cursor", "skills", folder, skillDir, "SKILL.md");
  if (fs.existsSync(primary)) return primary;

  const fallback = path.join(root, "docs", "skills", folder, skillDir, "SKILL.md");
  if (fs.existsSync(fallback)) return fallback;

  return null;
}

export function loadSkillMarkdown(skillKey: string): string | null {
  const filePath = resolveSkillMarkdownPath(skillKey);
  if (!filePath) return null;
  return fs.readFileSync(filePath, "utf8");
}
