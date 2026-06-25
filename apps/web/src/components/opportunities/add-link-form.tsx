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

  const options = useMemo(() => linkOptions[entityType] ?? [], [entityType, linkOptions]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!entityId) return;
    setLoading(true);
    await fetch(`/api/opportunities/${opportunityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_link", entityType, entityId }),
    });
    setLoading(false);
    setEntityId("");
    router.refresh();
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
        <option value="proposal">Proposal</option>
        <option value="partner">Partner</option>
        <option value="customer">Customer</option>
      </select>
      <select
        className="h-9 min-w-[180px] rounded-md border bg-background px-2 text-sm"
        value={entityId}
        onChange={(e) => setEntityId(e.target.value)}
        required
      >
        <option value="">Select {entityType}…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={loading || options.length === 0}>
        {loading ? "Linking..." : "Link"}
      </Button>
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

  async function onRemove() {
    setLoading(true);
    await fetch(`/api/opportunities/${opportunityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove_link", linkId }),
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={onRemove}>
      {loading ? "…" : "Remove"}
    </Button>
  );
}
