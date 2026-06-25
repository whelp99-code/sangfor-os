import type { NormalizedSkillOutput } from "./types";

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractJsonBlock(raw: string): Record<string, unknown> | null {
  const match = raw.match(/```json\s*([\s\S]*?)```/i);
  if (!match?.[1]) return null;
  return tryParseJson(match[1].trim());
}

export function normalizeSkillOutput(raw: unknown): NormalizedSkillOutput {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ok: true, data: raw as Record<string, unknown> };
  }

  if (typeof raw !== "string") {
    return {
      ok: false,
      data: {},
      raw: String(raw),
      normalizeError: "Output was not JSON or object",
    };
  }

  const direct = tryParseJson(raw);
  if (direct) {
    return { ok: true, data: direct, raw };
  }

  const block = extractJsonBlock(raw);
  if (block) {
    return { ok: true, data: block, raw };
  }

  return {
    ok: false,
    data: { summary: raw.slice(0, 500) },
    raw,
    normalizeError: "Could not parse structured JSON output",
  };
}
