"use client";

import React from "react";
import { UX_COPY } from "@/lib/ux-copy";

interface Props {
  kind: "loading" | "error" | "not_found" | "empty";
  code?: string;
  onRetry?: () => void;
}

export function RouteState({ kind, code, onRetry }: Props) {
  if (kind === "loading") {
    return (
      <div className="route-state route-state-loading p-8 text-center" aria-live="polite" data-testid="route-state-loading">
        <p className="text-gray-500 font-medium">{UX_COPY.loading}</p>
      </div>
    );
  }

  if (kind === "error") {
    return (
      <div className="route-state route-state-error p-8 text-center" data-testid="route-state-error">
        <h2 className="text-xl font-bold text-red-600 mb-2">{UX_COPY.errorTitle}</h2>
        <p className="text-sm text-gray-600 mb-4">{UX_COPY.errorMessage}</p>
        {code && <p className="font-mono text-xs text-gray-400 mb-4">코드: {code}</p>}
        {onRetry && (
          <button onClick={onRetry} className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700">
            {UX_COPY.retryButton}
          </button>
        )}
      </div>
    );
  }

  if (kind === "not_found") {
    return (
      <div className="route-state route-state-not-found p-8 text-center" data-testid="route-state-not-found">
        <h2 className="text-xl font-bold mb-2">{UX_COPY.notFoundTitle}</h2>
        <p className="text-sm text-gray-600 mb-4">{UX_COPY.notFoundMessage}</p>
      </div>
    );
  }

  return (
    <div className="route-state route-state-empty p-8 text-center" data-testid="route-state-empty">
      <h3 className="text-lg font-semibold mb-1">{UX_COPY.emptyTitle}</h3>
      <p className="text-xs text-gray-500">{UX_COPY.emptyMessage}</p>
    </div>
  );
}
