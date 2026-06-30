"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Handshake } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { regStatusMeta, regStatusInlineClasses } from "@/components/deals/reg-status";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegistrationPanelProps = {
  opportunityId: string;
  customerName?: string | null;
  partnerName?: string | null;
  dealRegistration?: {
    regStatus?: string | null;
    registrationNumber?: string | null;
    protectionExpiresAt?: string | Date | null;
    sprStatus?: string | null;
    partnerTierMargin?: number | null;
    distributor?: { id: string; name: string } | null;
  } | null;
  distributorOptions?: { id: string; label: string }[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REG_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "NOT_SUBMITTED", label: "미등록" },
  { value: "SUBMITTED", label: "검토중" },
  { value: "APPROVED", label: "보호중 (승인)" },
  { value: "REJECTED", label: "거절" },
  { value: "EXPIRED", label: "만료" },
  { value: "CONTESTED", label: "충돌" },
];

// ---------------------------------------------------------------------------
// Channel chain sub-component
// ---------------------------------------------------------------------------

function ChannelChain({
  distributorName,
  customerName,
}: {
  distributorName?: string | null;
  customerName?: string | null;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs font-medium"
      aria-label="채널 체인"
    >
      <span className="rounded-full border bg-muted px-3 py-1">Sangfor</span>

      <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />

      <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-muted-foreground">
        {distributorName ?? "총판 미지정"}
      </span>

      <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />

      <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary">
        <Handshake className="size-3" aria-hidden="true" />
        나 · Platinum
      </span>

      <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />

      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
        {customerName ?? "고객 미지정"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RegistrationPanel
// ---------------------------------------------------------------------------

export function RegistrationPanel({
  opportunityId,
  customerName,
  partnerName,
  dealRegistration,
  distributorOptions = [],
}: RegistrationPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const reg = dealRegistration;

  // Resolve display distributor name
  const distributorName = reg?.distributor?.name ?? partnerName;

  // Current status meta
  const currentProtectionExpiresAt = reg?.protectionExpiresAt
    ? new Date(reg.protectionExpiresAt).toISOString()
    : null;
  const statusMeta = regStatusMeta(reg?.regStatus ?? null, currentProtectionExpiresAt);

  // Form state
  const [distributorId, setDistributorId] = useState<string>(
    reg?.distributor?.id ?? "",
  );
  const [registrationNumber, setRegistrationNumber] = useState<string>(
    reg?.registrationNumber ?? "",
  );
  const [regStatus, setRegStatus] = useState<string>(
    reg?.regStatus ?? "NOT_SUBMITTED",
  );
  const [protectionExpiresAt, setProtectionExpiresAt] = useState<string>(
    reg?.protectionExpiresAt
      ? new Date(reg.protectionExpiresAt).toISOString().slice(0, 10)
      : "",
  );
  const [sprStatus, setSprStatus] = useState<string>(reg?.sprStatus ?? "");
  const [partnerTierMargin, setPartnerTierMargin] = useState<string>(
    reg?.partnerTierMargin != null ? String(reg.partnerTierMargin) : "",
  );

  function handleSave() {
    setError(null);
    setSuccess(false);

    const body: Record<string, unknown> = {
      regStatus,
      registrationNumber: registrationNumber || null,
      protectionExpiresAt: protectionExpiresAt || null,
      sprStatus: sprStatus || null,
      partnerTierMargin: partnerTierMargin !== "" ? Number(partnerTierMargin) : null,
    };
    if (distributorId) body.distributorId = distributorId;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/opportunities/${opportunityId}/registration`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setError(data.error ?? "저장 실패");
          return;
        }
        setSuccess(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "네트워크 오류");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Channel chain */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">채널 체인</CardTitle>
        </CardHeader>
        <CardContent>
          <ChannelChain
            distributorName={distributorName}
            customerName={customerName}
          />
        </CardContent>
      </Card>

      {/* Current state summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">현재 딜 등록 상태</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">등록 상태</p>
            <p className={cn("mt-0.5 font-semibold", regStatusInlineClasses(statusMeta.tone))}>
              {statusMeta.label}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">딜 등록 번호</p>
            <p className="mt-0.5 font-semibold">
              {reg?.registrationNumber ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">보호 만료일</p>
            <p className="mt-0.5 font-semibold">
              {reg?.protectionExpiresAt
                ? new Date(reg.protectionExpiresAt).toLocaleDateString("ko-KR")
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">SPR</p>
            <p className="mt-0.5 font-semibold">{reg?.sprStatus ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Platinum 마진</p>
            <p className="mt-0.5 font-semibold">
              {reg?.partnerTierMargin != null
                ? `${reg.partnerTierMargin}%`
                : "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Edit form */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">딜 등록 편집</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Distributor select */}
          {distributorOptions.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="reg-distributor" className="text-sm font-medium">
                총판
              </label>
              <Select
                value={distributorId || null}
                onValueChange={(val) => setDistributorId(val ?? "")}
              >
                <SelectTrigger id="reg-distributor" className="w-full">
                  <SelectValue placeholder="총판 선택" />
                </SelectTrigger>
                <SelectContent>
                  {distributorOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Registration number */}
          <div className="space-y-1.5">
            <label htmlFor="reg-number" className="text-sm font-medium">
              딜 등록 번호
            </label>
            <Input
              id="reg-number"
              placeholder="예) DR-2024-001"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
            />
          </div>

          {/* Reg status select */}
          <div className="space-y-1.5">
            <label htmlFor="reg-status" className="text-sm font-medium">
              등록 상태
            </label>
            <Select
              value={regStatus}
              onValueChange={(val) => { if (val) setRegStatus(val); }}
            >
              <SelectTrigger id="reg-status" className="w-full">
                <SelectValue placeholder="상태 선택" />
              </SelectTrigger>
              <SelectContent>
                {REG_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Protection expires at */}
          <div className="space-y-1.5">
            <label htmlFor="reg-protection-expires" className="text-sm font-medium">
              보호 만료일
            </label>
            <Input
              id="reg-protection-expires"
              type="date"
              value={protectionExpiresAt}
              onChange={(e) => setProtectionExpiresAt(e.target.value)}
            />
          </div>

          {/* SPR */}
          <div className="space-y-1.5">
            <label htmlFor="reg-spr" className="text-sm font-medium">
              SPR
            </label>
            <Input
              id="reg-spr"
              placeholder="SPR 코드"
              value={sprStatus}
              onChange={(e) => setSprStatus(e.target.value)}
            />
          </div>

          {/* Partner tier margin */}
          <div className="space-y-1.5">
            <label htmlFor="reg-margin" className="text-sm font-medium">
              Platinum 마진 (%)
            </label>
            <Input
              id="reg-margin"
              type="number"
              min={0}
              max={100}
              step={0.1}
              placeholder="예) 12.5"
              value={partnerTierMargin}
              onChange={(e) => setPartnerTierMargin(e.target.value)}
            />
          </div>

          {/* Error / success feedback */}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
              저장되었습니다.
            </p>
          )}

          <Button
            onClick={handleSave}
            disabled={isPending}
            aria-busy={isPending}
            className="w-full sm:w-auto"
          >
            {isPending ? "저장 중..." : "저장"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
