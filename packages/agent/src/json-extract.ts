/**
 * Robust extraction of a single JSON object from an LLM completion.
 * Tolerates code fences and surrounding prose, since not every model honors
 * json_object strictly.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  // Fast path: the whole string is JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to fenced / embedded extraction */
  }

  // Strip a ```json ... ``` (or plain ```) fence if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }

  // Last resort: take the first balanced { ... } span.
  const start = trimmed.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.slice(start, i + 1);
          return JSON.parse(candidate);
        }
      }
    }
  }

  throw new Error("No JSON object found in LLM output");
}
