"use client";

import React from "react";
import { RouteState } from "@/components/ui/route-state";

export default function RoiDashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main-content" tabIndex={-1}>
      <RouteState kind="error" code={error.digest} onRetry={reset} />
    </main>
  );
}
