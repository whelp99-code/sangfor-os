"use client";

import { CFO } from "@/lib/cfo-theme";

export default function CfoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: CFO.paper, border: `1px solid ${CFO.hairline}`, color: CFO.ink }}
    >
      <p className="font-semibold" style={{ color: CFO.outflow }}>
        페이지를 표시할 수 없습니다
      </p>
      <p className="mt-2 text-sm" style={{ color: CFO.muted }}>
        {error.message}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-3 cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: CFO.ink }}
      >
        다시 시도
      </button>
    </div>
  );
}
