"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function AutopilotKillSwitch({ enabled: initialEnabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/autopilot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? `요청 실패 (${res.status})`);
      }
      setEnabled(next);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "토글 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;

  return (
    <div className="act" style={{ borderTop: 0, borderRadius: 9 }}>
      <button
        type="button"
        className={`btn ${enabled ? "ap" : ""}`}
        disabled={working}
        onClick={toggle}
      >
        {working ? "처리 중…" : enabled ? "자동운영 ON" : "자동운영 OFF"}
      </button>
      <span className="ago mono">
        {error ? (
          <span style={{ color: "var(--ck-red-deep)" }}>{error}</span>
        ) : enabled ? (
          "전체 도메인 auto 정책 적용 중"
        ) : (
          "킬스위치 작동 — 전부 관찰 강등"
        )}
      </span>
    </div>
  );
}
