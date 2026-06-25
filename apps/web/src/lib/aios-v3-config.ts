/**
 * AIOS v3 Configuration
 *
 * Centralised connection settings for the F-aios-v3-core services.
 * These values can be overridden via environment variables.
 *
 * Services:
 * - AIOS v3 Server (workflow orchestration, monitoring, LightRAG)
 * - LM Studio (local LLM inference)
 */

export interface AiosV3ServiceConfig {
  /** Base URL of the F-aios-v3-core server (workflow + monitoring + lightrag) */
  serverBaseUrl: string;
  /** Base URL of the LM Studio instance for local LLM inference */
  lmStudioBaseUrl: string;
  /** Timeout in milliseconds for server requests */
  serverTimeoutMs: number;
  /** Timeout in milliseconds for LM Studio requests */
  lmStudioTimeoutMs: number;
  /** Enable verbose logging for debugging integration issues */
  debug: boolean;
}

const DEFAULTS: AiosV3ServiceConfig = {
  serverBaseUrl: "http://localhost:3201",
  lmStudioBaseUrl: "http://localhost:1234",
  serverTimeoutMs: 30_000,
  lmStudioTimeoutMs: 60_000,
  debug: false,
};

/**
 * Returns the resolved AIOS v3 configuration.
 * Environment variables take precedence over defaults.
 */
export function getAiosV3Config(): AiosV3ServiceConfig {
  return {
    serverBaseUrl:
      process.env.AIOS_V3_SERVER_URL?.replace(/\/$/, "") || DEFAULTS.serverBaseUrl,
    lmStudioBaseUrl:
      process.env.AIOS_V3_LM_STUDIO_URL?.replace(/\/$/, "") || DEFAULTS.lmStudioBaseUrl,
    serverTimeoutMs: parsePositiveInt(
      process.env.AIOS_V3_SERVER_TIMEOUT_MS,
      DEFAULTS.serverTimeoutMs,
    ),
    lmStudioTimeoutMs: parsePositiveInt(
      process.env.AIOS_V3_LM_STUDIO_TIMEOUT_MS,
      DEFAULTS.lmStudioTimeoutMs,
    ),
    debug: process.env.AIOS_V3_DEBUG === "true",
  };
}

/** Convenience accessors for individual URLs */
export function getAiosV3ServerUrl(): string {
  return getAiosV3Config().serverBaseUrl;
}

export function getLmStudioUrl(): string {
  return getAiosV3Config().lmStudioBaseUrl;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
