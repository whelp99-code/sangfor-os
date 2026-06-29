"use client";

import { useState, useEffect } from "react";
import { CfoPageHeading } from "@/components/cfo/page-heading";
import { CFO } from "@/lib/cfo-theme";

/* ── Business number section ──────────────────────────── */
function BusinessNumberSection() {
  const [businessNumber, setBusinessNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [ceoName, setCeoName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/finance/company-settings")
      .then((r) => r.json())
      .then((d: { businessNumber?: string; companyName?: string; ceoName?: string }) => {
        setBusinessNumber(d.businessNumber ?? "");
        setCompanyName(d.companyName ?? "");
        setCeoName(d.ceoName ?? "");
      })
      .catch(() => {/* ignore — may be unconfigured */})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch("/api/finance/company-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessNumber: businessNumber.trim(),
          companyName: companyName.trim() || undefined,
          ceoName: ceoName.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("저장 실패");
      setSaved(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    border: `1px solid ${CFO.hairline}`,
    background: "#fff",
    color: CFO.ink,
  };
  const labelCls =
    "mb-1 block text-[11px] font-medium uppercase tracking-wide";

  return (
    <div
      className="rounded-xl border p-5 space-y-4"
      style={{ borderColor: CFO.hairline, background: "#fff" }}
    >
      <div>
        <h2
          className="text-base font-semibold tracking-tight"
          style={{ color: CFO.ink }}
        >
          회사 사업자등록번호
        </h2>
        <div className="mt-0.5 h-0.5 w-10" style={{ background: CFO.brass }} />
        <p className="mt-1.5 text-xs" style={{ color: CFO.muted }}>
          받은 세금계산서 복호화 키로 사용됩니다.
        </p>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: CFO.muted }}>
          로딩 중...
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls} style={{ color: CFO.muted }}>
              사업자등록번호 *
            </label>
            <input
              type="text"
              value={businessNumber}
              onChange={(e) => setBusinessNumber(e.target.value)}
              placeholder="000-00-00000"
              className="w-full rounded-md px-3 py-2 text-sm tabular-nums"
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelCls} style={{ color: CFO.muted }}>
              회사명
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="(주)회사명"
              className="w-full rounded-md px-3 py-2 text-sm"
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelCls} style={{ color: CFO.muted }}>
              대표자
            </label>
            <input
              type="text"
              value={ceoName}
              onChange={(e) => setCeoName(e.target.value)}
              placeholder="홍길동"
              className="w-full rounded-md px-3 py-2 text-sm"
              style={inputStyle}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: CFO.ink }}
        >
          {saving ? "저장 중..." : "저장"}
        </button>
        {saved && (
          <span className="text-sm font-medium" style={{ color: CFO.inflow }}>
            ✓ 저장됨
          </span>
        )}
        {error && (
          <span className="text-sm" style={{ color: CFO.outflow }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── API status section (previously inline) ───────────── */
async function fetchStatus(path: string): Promise<unknown> {
  try {
    const res = await fetch(`/api/finance/${path}`);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return res.json();
  } catch {
    return { error: "unavailable" };
  }
}

function StatusSection({
  title,
  endpoint,
}: {
  title: string;
  endpoint: string;
}) {
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    fetchStatus(endpoint).then(setData);
  }, [endpoint]);

  return (
    <div
      className="rounded-xl border p-5"
      style={{ borderColor: CFO.hairline, background: "#fff" }}
    >
      <h2
        className="mb-2 text-base font-semibold tracking-tight"
        style={{ color: CFO.ink }}
      >
        {title}
      </h2>
      <pre
        className="overflow-x-auto text-xs"
        style={{ color: CFO.muted }}
      >
        {data === null ? "로딩 중..." : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────── */
export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <CfoPageHeading title="연동 설정" />

      <BusinessNumberSection />

      <StatusSection title="API 상태" endpoint="health/ready" />
      <StatusSection title="Popbill (세금계산서)" endpoint="popbill/status" />
      <StatusSection title="CODEF (금융)" endpoint="codef/status" />
      <StatusSection title="Notion 동기화" endpoint="notion-sync/status" />

      <p className="text-sm" style={{ color: CFO.muted }}>
        환경변수는 repo 루트 <code>.env</code>에서 설정합니다. 자세한 내용은
        README와 NOTION_MCP_GUIDE.md를 참고하세요.
      </p>
    </div>
  );
}
