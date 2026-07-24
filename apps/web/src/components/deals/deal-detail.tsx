"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { stageLabel } from "@/components/deals/stage-meta";
import { winProbabilityLabel } from "@/components/deals/win-probability";
import { DealDetailSection } from "@/components/deals/deal-detail-section";
import { InlineField } from "@/components/deals/inline-field";
import { regStatusMeta, regStatusInlineClasses } from "@/components/deals/reg-status";
import { formatDate } from "@/lib/format-date";

// ---------------------------------------------------------------------------
// Explicit type matching the shape returned by getOpportunityDetail.
// Using an explicit interface to avoid bundling @prisma/client in the client.
// ---------------------------------------------------------------------------
export type OpportunityForDetail = {
  id: string;
  title: string;
  stage: string;
  dealStatus: string;
  lostReason: string | null;
  dealType: string | null;
  ownerId: string | null;
  ownerAssignmentId: string | null;
  ownershipRevision: number;
  ownerAssignment?: { id: string; userId: string; role: string; status: string | null } | null;
  amount: { toString(): string } | number | null;
  probability: number;
  closeDate: Date | string | null;
  nextAction: string | null;
  updatedAt: Date | string;
  customer: { name: string } | null;
  partner: { name: string } | null;
  distributor?: { name: string } | null;
  dealRegistration?: {
    regStatus: string | null;
    registrationNumber: string | null;
    protectionExpiresAt: Date | string | null;
    sprStatus: string | null;
    partnerTierMargin: number | null;
    distributor?: { name: string } | null;
  } | null;
};

// ---------------------------------------------------------------------------
// Deal-status pill
// ---------------------------------------------------------------------------
const DEAL_STATUS_LABEL: Record<string, string> = {
  OPEN: "진행",
  WON: "수주",
  LOST: "실주",
  ON_HOLD: "보류",
  DISQUALIFIED: "미자격",
};

const DEAL_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  OPEN: "default",
  WON: "secondary",
  LOST: "destructive",
  ON_HOLD: "outline",
  DISQUALIFIED: "outline",
};

function DealStatusPill({ status }: { status: string }) {
  const label = DEAL_STATUS_LABEL[status] ?? status;
  const variant = DEAL_STATUS_VARIANT[status] ?? "outline";
  return (
    <Badge variant={variant} className="font-bold">
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
const DEAL_TYPE_OPTIONS = [
  { value: "NEW_BUILD", label: "신규 구축" },
  { value: "RENEWAL", label: "갱신" },
  { value: "UPSELL", label: "업셀" },
  { value: "SIMPLE_RESELL", label: "단순 리셀" },
];

const DEAL_STATUS_OPTIONS = [
  { value: "OPEN", label: "진행" },
  { value: "WON", label: "수주" },
  { value: "LOST", label: "실주" },
  { value: "ON_HOLD", label: "보류" },
  { value: "DISQUALIFIED", label: "미자격" },
];

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------
function formatAmount(value: { toString(): string } | number | null | undefined): string {
  if (value == null) return "—";
  const n = typeof value === "number" ? value : Number(value.toString());
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDealType(value: string | null | undefined): string {
  if (!value) return "—";
  return DEAL_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
type DealDetailProps = {
  opportunity: OpportunityForDetail;
  readOnly?: boolean;
  eligibleOwners: Array<{ id: string; userId: string; role: string }>;
};

function OwnerAssignmentControl({
  opportunity,
  eligibleOwners,
  readOnly,
}: {
  opportunity: OpportunityForDetail;
  eligibleOwners: Array<{ id: string; userId: string; role: string }>;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [selection, setSelection] = useState(opportunity.ownerAssignmentId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = opportunity.ownerAssignment
    ? `${opportunity.ownerAssignment.userId} · ${opportunity.ownerAssignment.role}`
    : opportunity.ownerId
      ? `레거시 담당 ${opportunity.ownerId}`
      : "미지정";

  if (readOnly) return <span className="text-sm font-semibold">{current}</span>;

  async function saveOwner() {
    if (!selection || selection === opportunity.ownerAssignmentId) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/opportunities/${opportunity.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: "assign_owner",
          ownerAssignmentId: selection,
          expectedOwnershipRevision: opportunity.ownershipRevision,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(payload.error === "CONFLICT" ? "담당자가 이미 변경되었습니다. 새로고침 후 다시 시도하세요." : "담당자를 변경하지 못했습니다.");
        return;
      }
      router.refresh();
    } catch {
      setError("담당자를 변경하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{current}</p>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="담당자 선택"
          className="h-9 min-w-56 rounded-md border bg-background px-3 text-sm"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
        >
          <option value="">담당자 선택</option>
          {eligibleOwners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.userId} · {owner.role}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" disabled={pending || !selection || selection === opportunity.ownerAssignmentId} onClick={saveOwner}>
          {pending ? "변경 중..." : "담당 변경"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function DealDetail({
  opportunity,
  readOnly = false,
  eligibleOwners,
}: DealDetailProps) {
  const opp = opportunity;
  const id = opp.id;

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-bold">딜 상세 정보</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border/40 pb-4">

        {/* ① 딜 정보 ---------------------------------------------------- */}
        <DealDetailSection title="딜 정보">
          <InlineField
            label="딜명"
            value={opp.title}
            field="title"
            editable={!readOnly}
            inputType="text"
            opportunityId={id}
            expectedUpdatedAt={new Date(opp.updatedAt).toISOString()}
            rawValue={opp.title}
          />
          <InlineField
            label="딜 유형"
            value={formatDealType(opp.dealType)}
            field="dealType"
            editable={!readOnly}
            inputType="select"
            options={DEAL_TYPE_OPTIONS}
            opportunityId={id}
            expectedUpdatedAt={new Date(opp.updatedAt).toISOString()}
            rawValue={opp.dealType ?? "NEW_BUILD"}
          />
          <InlineField
            label="제품군"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="공급가 (KRW)"
            value={formatAmount(opp.amount)}
            field="amount"
            editable={!readOnly}
            inputType="number"
            opportunityId={id}
            expectedUpdatedAt={new Date(opp.updatedAt).toISOString()}
            rawValue={opp.amount != null ? Number(opp.amount.toString()) : null}
          />
          <InlineField
            label="예상 마진"
            value="—"
            readOnly
            opportunityId={id}
          />
          <InlineField
            label="수주 확률"
            value={winProbabilityLabel(opp.probability, opp.stage)}
            readOnly
            opportunityId={id}
          />
          <InlineField
            label="현재 단계"
            value={stageLabel(opp.stage)}
            readOnly
            opportunityId={id}
          />
          <InlineField
            label="상태"
            value={<DealStatusPill status={opp.dealStatus} />}
            field="dealStatus"
            editable={!readOnly}
            inputType="select"
            options={DEAL_STATUS_OPTIONS}
            opportunityId={id}
            expectedUpdatedAt={new Date(opp.updatedAt).toISOString()}
            rawValue={opp.dealStatus}
          />
          <InlineField
            label="패배 사유"
            value={opp.lostReason ?? "—"}
            field="lostReason"
            editable={!readOnly}
            inputType="text"
            opportunityId={id}
            expectedUpdatedAt={new Date(opp.updatedAt).toISOString()}
            rawValue={opp.lostReason}
          />
        </DealDetailSection>

        {/* ② 채널·딜등록 ------------------------------------------------ */}
        {(() => {
          const reg = opp.dealRegistration;
          // Resolve distributor name: prefer dealRegistration.distributor, then opp.distributor, then partner
          const distributorName =
            reg?.distributor?.name ?? opp.distributor?.name ?? opp.partner?.name ?? "—";

          const regStatusRaw = reg?.regStatus ?? null;
          const protectionExpiresAt = reg?.protectionExpiresAt
            ? new Date(reg.protectionExpiresAt).toISOString()
            : null;
          const regMeta = regStatusMeta(regStatusRaw, protectionExpiresAt);

          return (
            <DealDetailSection title="채널·딜등록" columns={2}>
              <InlineField
                label="총판"
                value={distributorName}
                editable={false}
                opportunityId={id}
              />
              <InlineField
                label="딜 등록 번호"
                value={reg?.registrationNumber ?? "—"}
                editable={false}
                opportunityId={id}
              />
              <InlineField
                label="등록대행"
                value={reg?.distributor?.name ?? "—"}
                editable={false}
                opportunityId={id}
              />
              <InlineField
                label="보호 상태"
                value={
                  <span className={regStatusInlineClasses(regMeta.tone)}>
                    {regMeta.label}
                  </span>
                }
                editable={false}
                opportunityId={id}
              />
              <InlineField
                label="SPR"
                value={reg?.sprStatus ?? "—"}
                editable={false}
                opportunityId={id}
              />
              <InlineField
                label="Platinum 마진"
                value={
                  reg?.partnerTierMargin != null
                    ? `${reg.partnerTierMargin}%`
                    : "—"
                }
                editable={false}
                opportunityId={id}
              />
            </DealDetailSection>
          );
        })()}

        {/* ③ 고객·의사결정 --------------------------------------------- */}
        <DealDetailSection title="고객·의사결정" columns={2}>
          <div className="border-b border-border/40 px-1.5 py-2.5">
            <p className="mb-1 text-xs text-muted-foreground">담당자</p>
            <OwnerAssignmentControl
              opportunity={opp}
              eligibleOwners={eligibleOwners}
              readOnly={readOnly}
            />
          </div>
          <InlineField
            label="고객사"
            value={opp.customer?.name ?? "—"}
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="산업"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="주 연락처"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="실구매 결정자"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="챔피언"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="경쟁사"
            value="—"
            editable={false}
            opportunityId={id}
          />
        </DealDetailSection>

        {/* ④ 자격검증 (BANT) ------------------------------------------- */}
        {/* BANT scores come from DealQualification which is not yet included
            in getOpportunityDetail. All rendered as — until included. */}
        <DealDetailSection title="자격검증 (BANT)" columns={2}>
          <InlineField
            label="Budget (예산)"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="Authority (권한)"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="Need (필요성)"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="Timeline (일정)"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="실구매 결정자"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="챔피언"
            value="—"
            editable={false}
            opportunityId={id}
          />
        </DealDetailSection>

        {/* ⑤ 일정 ------------------------------------------------------ */}
        <DealDetailSection title="일정" columns={2}>
          <InlineField
            label="제안일"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="PoC 기간"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="예상 입찰일"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="마감/납품"
            value={formatDate(opp.closeDate, "—")}
            field="closeDate"
            editable={!readOnly}
            inputType="date"
            opportunityId={id}
            expectedUpdatedAt={new Date(opp.updatedAt).toISOString()}
            rawValue={opp.closeDate != null ? formatDate(opp.closeDate, "—") : null}
          />
        </DealDetailSection>

      </CardContent>
    </Card>
  );
}
