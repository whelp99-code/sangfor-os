/**
 * Env-gated Sentry helpers. No-op when DSN is unset.
 */

export function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN?.trim());
}

export function isApmTestRouteAllowed(): boolean {
  if (!isSentryConfigured()) return false;
  if (process.env.APM_TEST_ROUTE_ENABLED !== "1") return false;
  const environment = (process.env.SENTRY_ENVIRONMENT || "").trim().toLowerCase();
  if (environment === "staging" || environment === "local-staging") return true;
  if (process.env.NODE_ENV === "development") return true;
  return false;
}

export function sentryTracesSampleRate(): number {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0;
}
