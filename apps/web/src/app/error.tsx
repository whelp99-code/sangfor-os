"use client";

import React from "react";
import { RouteState } from "@/components/ui/route-state";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body>
        <RouteState kind="error" code={error.digest} onRetry={reset} />
      </body>
    </html>
  );
}
