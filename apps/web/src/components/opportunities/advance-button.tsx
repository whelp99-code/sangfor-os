"use client";

import { Button } from "@/components/ui/button";

import { normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";

export function AdvanceOpportunityButton({ id, stage }: { id: string; stage: string }) {
  const canonical = normalizeOpportunityStage(stage);
  if (canonical === "WON" || canonical === "LOST") return null;

  async function advance() {
    await fetch(`/api/opportunities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "advance" }),
    });
    window.location.reload();
  }

  return (
    <Button size="sm" onClick={advance}>
      Advance stage
    </Button>
  );
}
