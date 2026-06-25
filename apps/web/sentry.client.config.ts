import * as Sentry from "@sentry/nextjs";

const dsn =
  process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || process.env.SENTRY_DSN?.trim();

if (dsn) {
  const sampleRaw = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
  const tracesSampleRate = sampleRaw
    ? Number(sampleRaw)
    : Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0);

  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || "development",
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
    enabled: true,
  });
}
