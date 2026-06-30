"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { stageLabel } from "@/components/deals/stage-meta";
import { DealDetailSection } from "@/components/deals/deal-detail-section";
import { InlineField } from "@/components/deals/inline-field";
import { regStatusMeta, regStatusInlineClasses } from "@/components/deals/reg-status";

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
  amount: { toString(): string } | number | null;
  probability: number;
  closeDate: Date | string | null;
  nextAction: string | null;
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
  LOST: "실패",
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
  { value: "LOST", label: "실패" },
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

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
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
};

export function DealDetail({ opportunity }: DealDetailProps) {
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
            inputType="text"
            opportunityId={id}
            rawValue={opp.title}
          />
          <InlineField
            label="딜 유형"
            value={formatDealType(opp.dealType)}
            field="dealType"
            inputType="select"
            options={DEAL_TYPE_OPTIONS}
            opportunityId={id}
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
            inputType="number"
            opportunityId={id}
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
            value={opp.probability != null ? `${opp.probability}%` : "—"}
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
            inputType="select"
            options={DEAL_STATUS_OPTIONS}
            opportunityId={id}
            rawValue={opp.dealStatus}
          />
          <InlineField
            label="패배 사유"
            value={opp.lostReason ?? "—"}
            field="lostReason"
            inputType="text"
            opportunityId={id}
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
            label="Economic Buyer"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="Champion"
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
            label="Economic Buyer"
            value="—"
            editable={false}
            opportunityId={id}
          />
          <InlineField
            label="Champion"
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
            value={formatDate(opp.closeDate)}
            field="closeDate"
            inputType="date"
            opportunityId={id}
            rawValue={opp.closeDate != null ? formatDate(opp.closeDate) : null}
          />
        </DealDetailSection>

      </CardContent>
    </Card>
  );
}
