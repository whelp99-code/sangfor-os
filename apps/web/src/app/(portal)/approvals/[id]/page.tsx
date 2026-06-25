"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  MinusCircle,
  FileText,
  DollarSign,
  Activity,
  GitCompare,
  ShieldCheck,
  Brain,
  History,
  User,
  Calendar,
  FileSpreadsheet,
  FileBarChart,
  Beaker,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ApprovalStatus = "pending" | "approved" | "rejected" | "auto_validating" | "auto_failed" | "remediation_required" | "ready_for_human_approval" | "stale";

type ColorStatus = "passed" | "pending" | "failed" | "not_required";

type ColorReview = {
  color: string;
  label: string;
  desc: string;
  status: ColorStatus;
};

type ApprovalHistoryEvent = {
  action: string;
  actor: string;
  timestamp: string;
  note?: string;
};

type ValidationCheck = {
  name: string;
  status: "passed" | "failed" | "warning";
  detail: string;
};

type DiffEntry = {
  field: string;
  before: string;
  after: string;
};

const APPROVAL = {
  id: "APPR-2024-0042",
  title: "Commercial Approval — 신한은행 차세대 보안 인프라",
  requester: "김영업",
  createdAt: "2026-06-20 14:32",
  status: "ready_for_human_approval" as ApprovalStatus,
  customer: "신한은행",
  opportunity: "OPP-2024-0842",
  type: "commercial",
};

const DIFFS: DiffEntry[] = [
  { field: "할인율", before: "15%", after: "22%" },
  { field: "총 계약 금액", before: "₩450,000,000", after: "₩420,000,000" },
  { field: "Payment Terms", before: "Net 30", after: "Net 60" },
  { field: "유지보수 기간", before: "12 months", after: "24 months" },
  { field: "SLA 응답 시간", before: "4 hours", after: "8 hours" },
];

const VALIDATIONS: ValidationCheck[] = [
  { name: "Margin floor check", status: "failed", detail: "예상 마진 18% < 최소 마진 20%" },
  { name: "Discount authority", status: "passed", detail: "영업 관리자 할인 한도 내 (max 25%)" },
  { name: "Customer credit", status: "passed", detail: "신용 등급 A — 이상 없음" },
  { name: "Contract compliance", status: "warning", detail: "Payment term Net 60 — 표준 조건 아님" },
  { name: "Product availability", status: "passed", detail: "재고 확인 완료" },
  { name: "Maintenance cost calc", status: "passed", detail: "유지보수 비용 정상 계산" },
];

const COLOR_REVIEWS: ColorReview[] = [
  { color: "Blue", label: "기술 검토", desc: "Technical Direction / Architecture", status: "passed" },
  { color: "Red", label: "리스크 검토", desc: "Risk & Safety / Security", status: "pending" },
  { color: "Orange", label: "비즈니스 가치 검토", desc: "Product & Business Value", status: "passed" },
  { color: "Gray", label: "문서/근거 검토", desc: "Documentation & Evidence", status: "failed" },
  { color: "Teal", label: "UX/가시성 검토", desc: "UX & Visibility", status: "not_required" },
];

const HISTORY: ApprovalHistoryEvent[] = [
  { action: "제출", actor: "김영업", timestamp: "2026-06-20 14:32", note: "상업 조건 변경 승인 요청" },
  { action: "자동 검증 완료", actor: "AIOS", timestamp: "2026-06-20 14:35", note: "6개 항목 중 4개 통과" },
  { action: "Gray Review 실패", actor: "정문서", timestamp: "2026-06-21 09:15", note: "근거 문서 누락 — 재무제표 근거 필요" },
  { action: "재제출", actor: "김영업", timestamp: "2026-06-22 11:00", note: "재무제표 근거 첨부" },
  { action: "Gray Review 통과", actor: "정문서", timestamp: "2026-06-22 14:30", note: "근거 확인 완료" },
  { action: "승인 대기", actor: "시스템", timestamp: "2026-06-22 14:31", note: "모든 Color Review 완료, 최종 승인 대기" },
];

const RELATED_ARTIFACTS = [
  { type: "Proposal", id: "PROP-2024-0031", title: "신한은행 차세대 보안 인프라 제안서", href: "/proposals/PROP-2024-0031" },
  { type: "Quote", id: "QTE-2024-0018", title: "견적서 v3.2", href: "#" },
  { type: "PoC Result", id: "POC-2024-0007", title: "PoC 결과 보고서 — 신한은행", href: "/poc/POC-2024-0007" },
];

const STATUS_MAP: Record<ApprovalStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "대기", variant: "outline" },
  auto_validating: { label: "자동 검증 중", variant: "secondary" },
  auto_failed: { label: "자동 검증 실패", variant: "destructive" },
  remediation_required: { label: "수정 필요", variant: "destructive" },
  ready_for_human_approval: { label: "승인 대기", variant: "secondary" },
  approved: { label: "승인 완료", variant: "default" },
  rejected: { label: "반려", variant: "destructive" },
  stale: { label: "재검토 필요", variant: "outline" },
};

function ColorStatusIcon({ status }: { status: ColorStatus }) {
  switch (status) {
    case "passed": return <CheckCircle2 className="h-4 w-4 text-emerald-500" role="img" aria-label="Passed" />;
    case "pending": return <Clock className="h-4 w-4 text-amber-500" role="img" aria-label="Pending" />;
    case "failed": return <XCircle className="h-4 w-4 text-red-500" role="img" aria-label="Failed" />;
    case "not_required": return <MinusCircle className="h-4 w-4 text-gray-400" role="img" aria-label="Not Required" />;
  }
}

function ValidationStatusIcon({ status }: { status: ValidationCheck["status"] }) {
  switch (status) {
    case "passed": return <CheckCircle2 className="h-4 w-4 text-emerald-500" role="img" aria-label="Validation passed" />;
    case "failed": return <XCircle className="h-4 w-4 text-red-500" role="img" aria-label="Validation failed" />;
    case "warning": return <AlertTriangle className="h-4 w-4 text-amber-500" role="img" aria-label="Validation warning" />;
  }
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-1">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
        {icon}
      </div>
      <h2 className="text-base font-medium">{title}</h2>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const statusInfo = STATUS_MAP[APPROVAL.status];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Link href="/approvals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to approvals
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{APPROVAL.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
            <Badge variant="outline">{APPROVAL.id}</Badge>
            <Badge variant="outline">{APPROVAL.type}</Badge>
          </div>
        </div>
        {APPROVAL.status === "ready_for_human_approval" && (
          <div className="flex items-center gap-2">
            <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <DialogTrigger render={<Button variant="destructive">Reject</Button>} />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reject approval</DialogTitle>
                  <DialogDescription>
                    Are you sure you want to reject this approval? This will notify the requester.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={() => setRejectOpen(false)}>Confirm Reject</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
              <DialogTrigger render={<Button>Approve</Button>} />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Approve this request?</DialogTitle>
                  <DialogDescription>
                    This will finalize the commercial approval for {APPROVAL.customer}.
                    Review all checks before confirming.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
                  <Button onClick={() => setApproveOpen(false)}>Confirm Approval</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {/* Summary */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<User className="h-3.5 w-3.5" />} title="Approval summary" />
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <InfoRow label="Requester" value={APPROVAL.requester} />
                <InfoRow label="Created" value={APPROVAL.createdAt} />
                <InfoRow label="Customer" value={APPROVAL.customer} />
                <InfoRow label="Opportunity" value={APPROVAL.opportunity} />
              </div>
            </CardContent>
          </Card>

          {/* Diff View */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<GitCompare className="h-3.5 w-3.5" />} title="Changes (Diff)" />
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Field</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Before</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DIFFS.map((d) => (
                      <tr key={d.field} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">{d.field}</td>
                        <td className="px-3 py-2 text-muted-foreground line-through">{d.before}</td>
                        <td className="px-3 py-2 font-medium text-emerald-600 dark:text-emerald-400">{d.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Auto-validation Results */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<ShieldCheck className="h-3.5 w-3.5" />} title="Auto-validation results" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {VALIDATIONS.map((v) => (
                  <div key={v.name} className="flex items-start gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                    <ValidationStatusIcon status={v.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{v.name}</span>
                        <Badge variant={v.status === "failed" ? "destructive" : v.status === "warning" ? "secondary" : "default"} className="text-[10px]">
                          {v.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{v.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Revenue & Margin Impact */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<DollarSign className="h-3.5 w-3.5" />} title="Revenue &amp; Margin Impact" />
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/20 px-3 py-3">
                  <p className="text-xs text-muted-foreground">Total Revenue</p>
                  <p className="text-lg font-semibold">₩420,000,000</p>
                  <p className="text-xs text-red-500 flex items-center gap-1 mt-1">
                    <AlertTriangle className="h-3 w-3" />
                    -₩30,000,000 from original
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/20 px-3 py-3">
                  <p className="text-xs text-muted-foreground">Expected Margin</p>
                  <p className="text-lg font-semibold text-red-500">18%</p>
                  <p className="text-xs text-red-500 flex items-center gap-1 mt-1">
                    <AlertTriangle className="h-3 w-3" />
                    Below 20% floor
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/20 px-3 py-3">
                  <p className="text-xs text-muted-foreground">Discount Rate</p>
                  <p className="text-lg font-semibold text-amber-500">22%</p>
                  <p className="text-xs text-muted-foreground mt-1">+7% from standard</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Related Artifacts */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<FileText className="h-3.5 w-3.5" />} title="Related artifacts" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {RELATED_ARTIFACTS.map((a) => (
                  <Link
                    key={a.id}
                    href={a.href}
                    className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5 hover:bg-muted/40 transition-colors"
                  >
                    {a.type === "Proposal" ? <FileSpreadsheet className="h-4 w-4 text-blue-500" /> :
                     a.type === "Quote" ? <FileBarChart className="h-4 w-4 text-emerald-500" /> :
                     <Beaker className="h-4 w-4 text-purple-500" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground">{a.type} · {a.id}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{a.type}</Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* AI Generation Status */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<Brain className="h-3.5 w-3.5" />} title="AI Generation status" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
                  <Brain className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">AI Draft</p>
                  <p className="text-xs text-muted-foreground">
                    Initial proposal was AI-generated on 2026-06-18. Human review completed on 2026-06-19 with 3 modifications.
                  </p>
                </div>
                <Badge variant="secondary">Human reviewed</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Color Agent Review Status */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} title="Color Agent Review" />
            </CardHeader>
            <CardContent className="space-y-2">
              {COLOR_REVIEWS.map((cr) => (
                <div key={cr.color} className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <ColorStatusIcon status={cr.status} />
                    <div>
                      <p className="text-sm font-medium">{cr.color}</p>
                      <p className="text-[10px] text-muted-foreground">{cr.label}</p>
                    </div>
                  </div>
                  <Badge variant={cr.status === "failed" ? "destructive" : cr.status === "pending" ? "secondary" : cr.status === "passed" ? "default" : "outline"} className="text-[10px]">
                    {cr.status === "passed" ? "Passed" :
                     cr.status === "pending" ? "Pending" :
                     cr.status === "failed" ? "Failed" : "N/A"}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Approval History */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<History className="h-3.5 w-3.5" />} title="Approval history" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="relative ml-4 space-y-0">
                {HISTORY.map((event, i) => (
                  <div key={i} className="relative flex gap-4 pb-5 pl-6 last:pb-0">
                    <div className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-primary bg-background" />
                    {i < HISTORY.length - 1 && (
                      <div className="absolute left-[11px] top-4 h-full w-px bg-border" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{event.action}</p>
                        <span className="text-[10px] text-muted-foreground">{event.timestamp}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{event.actor}</p>
                      {event.note && (
                        <p className="mt-0.5 text-xs text-muted-foreground italic">{event.note}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
