import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { isApmTestRouteAllowed } from "@/lib/observability/sentry";

export async function POST() {
  if (!isApmTestRouteAllowed()) {
    return NextResponse.json(
      {
        ok: false,
        reason: "apm_test_route_disabled",
        hint: "Set SENTRY_DSN, SENTRY_ENVIRONMENT=staging, APM_TEST_ROUTE_ENABLED=1",
      },
      { status: 503 },
    );
  }

  try {
    const eventId = Sentry.captureException(
      new Error("Staging APM validation check event"),
    );
    await Sentry.flush(2_000).catch(() => undefined);
    const environment = process.env.SENTRY_ENVIRONMENT || "unknown";
    const org = process.env.SENTRY_ORG_SLUG?.trim();
    const project = process.env.SENTRY_PROJECT_SLUG?.trim();
    const issueUrlHint =
      org && project && eventId
        ? `https://sentry.io/organizations/${org}/issues/?query=${encodeURIComponent(eventId)}`
        : null;

    return NextResponse.json({
      ok: true,
      eventId: eventId ?? null,
      environment,
      issueUrlHint,
    });
  } catch {
    return NextResponse.json({ ok: false, swallowed: true }, { status: 200 });
  }
}
