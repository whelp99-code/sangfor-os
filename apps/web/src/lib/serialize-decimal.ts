type DecimalLike = {
  toString: () => string;
  toNumber?: () => number;
  d?: unknown;
  e?: unknown;
  s?: unknown;
};

function isDecimalLike(value: unknown): value is DecimalLike {
  if (!value || typeof value !== "object") return false;
  const candidate = value as DecimalLike;
  return (
    typeof candidate.toString === "function" &&
    ("toNumber" in candidate || ("d" in candidate && "e" in candidate && "s" in candidate))
  );
}

export function serializeDecimalAtBoundary<T>(value: T): T {
  if (value == null) return value;
  if (isDecimalLike(value)) {
    const asNumber = Number(value.toString());
    return (Number.isFinite(asNumber) ? asNumber : value.toString()) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeDecimalAtBoundary(entry)) as T;
  }
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = serializeDecimalAtBoundary(entry);
    }
    return output as T;
  }
  return value;
}
