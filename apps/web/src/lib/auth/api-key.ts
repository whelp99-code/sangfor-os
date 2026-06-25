import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * API Key authentication for dashboard API routes.
 *
 * Keys are configured via DASHBOARD_API_KEYS env var (comma-separated).
 * Each key is hashed with HMAC-SHA256 before comparison to prevent timing attacks.
 */

const API_KEY_HEADER = "x-api-key";
const API_KEY_QUERY = "apiKey";

function hashKey(key: string, secret: string): string {
  return createHmac("sha256", secret).update(key).digest("hex");
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET required for API key hashing");
  }
  return secret;
}

/**
 * Returns the set of configured API keys from env.
 * Empty set means API key auth is disabled (open access).
 */
export function getConfiguredApiKeys(): Set<string> {
  const raw = process.env.DASHBOARD_API_KEYS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0),
  );
}

/**
 * Validates an API key against configured keys using constant-time comparison.
 * Returns true if valid or if no keys are configured (open access).
 */
export function validateApiKey(provided: string | null): boolean {
  const keys = getConfiguredApiKeys();
  if (keys.size === 0) return true; // no keys configured = open

  if (!provided) return false;

  const secret = getSecret();
  const providedHash = hashKey(provided, secret);

  for (const configuredKey of keys) {
    const configuredHash = hashKey(configuredKey, secret);
    try {
      if (
        timingSafeEqual(
          Buffer.from(providedHash, "hex"),
          Buffer.from(configuredHash, "hex"),
        )
      ) {
        return true;
      }
    } catch {
      // length mismatch — skip
    }
  }
  return false;
}

/**
 * Extracts API key from request headers or query params.
 */
export function extractApiKey(request: Request): string | null {
  const headerKey = request.headers.get(API_KEY_HEADER);
  if (headerKey) return headerKey;

  const url = new URL(request.url);
  return url.searchParams.get(API_KEY_QUERY);
}

/**
 * Middleware-style guard for API routes.
 * Returns null if authorized, or a 401 Response if not.
 */
export function requireApiKey(request: Request): Response | null {
  const keys = getConfiguredApiKeys();
  if (keys.size === 0) return null; // auth disabled

  const provided = extractApiKey(request);
  if (validateApiKey(provided)) return null;

  return Response.json(
    { error: "Unauthorized", message: "Invalid or missing API key" },
    { status: 401 },
  );
}
