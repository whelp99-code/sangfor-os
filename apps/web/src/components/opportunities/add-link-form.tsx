"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type Option = { id: string; label: string };
type LinkOptions = {
  poc: Option[];
  proposal: Option[];
  partner: Option[];
  customer: Option[];
};

export function AddOpportunityLinkForm({
  opportunityId,
  linkOptions,
}: {
  opportunityId: string;
  linkOptions: LinkOptions;
}) {
  const router = useRouter();
  const [entityType, setEntityType] = useState<keyof LinkOptions>("poc");
  const [entityId, setEntityId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => linkOptions[entityType] ?? [], [entityType, linkOptions]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!entityId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_link", entityType, entityId }),
      });
      if (!res.ok) {
        setError("연결하지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      setEntityId("");
      router.refresh();
    } catch {
      setError("연결하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="flex flex-wrap gap-2" onSubmit={onSubmit}>
      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={entityType}
        onChange={(e) => {
          setEntityType(e.target.value as keyof LinkOptions);
          setEntityId("");
        }}
      >
        <option value="poc">PoC</option>
        <option value="proposal">제안</option>
        <option value="partner">파트너</option>
        <option value="customer">고객사</option>
      </select>
      <select
        className="h-9 min-w-[180px] rounded-md border bg-background px-2 text-sm"
        value={entityId}
        onChange={(e) => setEntityId(e.target.value)}
        required
      >
        <option value="">
          {options.length === 0 ? "사용 가능한 항목이 없습니다" : "선택…"}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={loading || options.length === 0}>
        {loading ? "연결 중..." : "연결"}
      </Button>
      {error && (
        <p className="w-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function RemoveOpportunityLinkButton({
  opportunityId,
  linkId,
}: {
  opportunityId: string;
  linkId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRemove() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_link", linkId }),
      });
      if (!res.ok) {
        setError("제거하지 못했습니다.");
        return;
      }
      router.refresh();
    } catch {
      setError("제거하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-0.5">
      <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={onRemove}>
        {loading ? "…" : "제거"}
      </Button>
      {error && (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
