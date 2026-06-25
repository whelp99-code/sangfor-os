import fs from "node:fs";

import { getRepoRoot } from "./repo-root";
import type { SkillCatalogEntry, SkillCatalogFile, SkillStatus } from "./types";

let cachedCatalog: SkillCatalogFile | null = null;

export function loadSkillCatalogFile(): SkillCatalogFile {
  if (cachedCatalog) return cachedCatalog;
  const catalogPath = `${getRepoRoot()}/docs/skills/skill-catalog.json`;
  const raw = fs.readFileSync(catalogPath, "utf8");
  cachedCatalog = JSON.parse(raw) as SkillCatalogFile;
  return cachedCatalog;
}

export function listSkillCatalog(options?: {
  phase?: number;
  status?: SkillStatus | SkillStatus[];
}): SkillCatalogEntry[] {
  const catalog = loadSkillCatalogFile();
  let skills = catalog.skills;

  if (options?.phase !== undefined) {
    skills = skills.filter((skill) => skill.phases.includes(options.phase!));
  }

  if (options?.status !== undefined) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    skills = skills.filter((skill) => statuses.includes(skill.status));
  }

  return skills;
}

export function getSkillCatalogEntry(skillKey: string): SkillCatalogEntry | undefined {
  return loadSkillCatalogFile().skills.find((skill) => skill.skillKey === skillKey);
}

export function getDefaultPhase13Flow(): string[] {
  return [...loadSkillCatalogFile().defaultPhase13Flow];
}

export function getRoutingRules() {
  return loadSkillCatalogFile().routingRules;
}

export function resetSkillCatalogCacheForTests() {
  cachedCatalog = null;
}
