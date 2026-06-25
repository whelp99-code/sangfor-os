import * as Sentry from "@sentry/nextjs";

import { isSentryConfigured, sentryTracesSampleRate } from "./src/lib/observability/sentry";

const dsn = process.env.SENTRY_DSN?.trim();
if (isSentryConfigured() && dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || "development",
    tracesSampleRate: sentryTracesSampleRate(),
    enabled: true,
  });
}
