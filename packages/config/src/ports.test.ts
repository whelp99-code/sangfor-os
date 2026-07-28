/**
 * U003 — Port registry contract (canonical eight + PORT-MAPPING.yaml agreement)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PORT_REGISTRY, validatePorts } from "./ports.js";

const STALE_KEYS = [
  "PORTAL",
  "AIOS_V2_WEB",
  "AIOS_V2_API",
  "AIOS_V2_LIGHTRAG",
  "AIOS_V2_JARVIS",
  "AIOS_V1",
  "F_AIOS_V3",
] as const;

const CANONICAL_EIGHT: Record<string, number> = {
  SANGFOR_WEB: 3101,
  SANGFOR_API: 3200,
  SANGFOR_MCP: 3500,
  SANGFOR_MOCK_CONSOLE: 3400,
  WHELP99_MCP_BRIDGE: 3600,
  WHELP99_OPERATOR_CONSOLE: 3502,
  SANGFOR_POSTGRES: 5434,
  SANGFOR_REDIS: 6380,
};

const YAML_CANONICAL: Record<string, number> = {
  web: 3101,
  api: 3200,
  "sangfor-mcp-workflow": 3500,
  "sangfor-mcp-mock-console": 3400,
  "sangfor-engineer-mcp": 3600,
  "sangfor-operator-console": 3502,
  postgres: 5434,
  redis: 6380,
};

/** Hand parser for two-level `  key:\n    port: N` entries; ignores comment lines. */
function parsePortMappingYaml(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  let currentKey: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^\s*#/.test(raw) || line.trim() === "") continue;
    const keyMatch = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      continue;
    }
    const portMatch = line.match(/^ {4}port:\s*(\d+)\s*$/);
    if (portMatch && currentKey) {
      out.set(currentKey, Number(portMatch[1]));
      currentKey = null;
    }
  }
  return out;
}

describe("PORT_REGISTRY", () => {
  it("validatePorts returns valid with zero conflicts", () => {
    const result = validatePorts();
    expect(result.valid).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it("exposes the canonical eight exact pairs", () => {
    for (const [key, port] of Object.entries(CANONICAL_EIGHT)) {
      expect(PORT_REGISTRY[key as keyof typeof PORT_REGISTRY]).toBe(port);
    }
  });

  it("does not contain the seven stale keys", () => {
    for (const key of STALE_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(PORT_REGISTRY, key)).toBe(false);
    }
  });

  it("agrees with PORT-MAPPING.yaml for canonical services and has no active duplicates", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
    const yamlPath = join(repoRoot, "PORT-MAPPING.yaml");
    const yamlText = readFileSync(yamlPath, "utf8");
    const mapped = parsePortMappingYaml(yamlText);

    expect(mapped.has("whelp99-mcp")).toBe(false);

    for (const [service, port] of Object.entries(YAML_CANONICAL)) {
      expect(mapped.get(service)).toBe(port);
    }

    const byPort = new Map<number, string[]>();
    for (const [name, port] of mapped) {
      const list = byPort.get(port) ?? [];
      list.push(name);
      byPort.set(port, list);
    }
    const dups = [...byPort.entries()].filter(([, names]) => names.length > 1);
    expect(dups).toEqual([]);
  });
});
