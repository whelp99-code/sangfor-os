"use client";

import { useState, useCallback } from "react";
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
  FileSpreadsheet,
  FileBarChart,
  Beaker,
  MessageSquare,
  ArrowUpCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { ColorReviewBadge } from "@/components/ui/color-review-badge";
import { displayStatus } from "@/lib/ux-labels";

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

const STATUS_VARIANT_MAP: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  auto_validating: "secondary",
  auto_failed: "destructive",
  remediation_required: "destructive",
  ready_for_human_approval: "secondary",
  approved: "default",
  rejected: "destructive",
  stale: "outline",
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

function Toast({ message, type, onClose }: { message: string; type: "success" | "error" | "info"; onClose: () => void }) {
  const bg = type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
    type === "error" ? "bg-red-50 border-red-200 text-red-800" :
    "bg-blue-50 border-blue-200 text-blue-800";
  return (
    <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 shadow-lg animate-in slide-in-from-right-2 ${bg}`}>
      <span className="text-sm">{message}</span>
      <button onClick={onClose} className="ml-2 text-xs opacity-60 hover:opacity-100">&times;</button>
    </div>
  );
}

export default function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  void params;
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const statusInfo = displayStatus(APPROVAL.status);
  const variant = STATUS_VARIANT_MAP[APPROVAL.status] ?? "outline";

  const showToast = useCallback((message: string, type: "success" | "error" | "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleAction = useCallback(async (action: string) => {
    setLoading(action);
    await new Promise((r) => setTimeout(r, 1200));
    setLoading(null);
    setApproveOpen(false);
    setRejectOpen(false);
    setRequestChangesOpen(false);
    setEscalateOpen(false);
    setComment("");
    showToast(`${action} successful`, "success");
  }, [showToast]);

  const canAct = APPROVAL.status === "ready_for_human_approval";

  const failedOrWarningValidations = VALIDATIONS.filter((v) => v.status === "failed" || v.status === "warning");

  return (
    <div className="space-y-6">
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}

      {/* Header */}
      <div className="flex flex-col gap-3">
        <Link href="/approvals" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to approvals
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{APPROVAL.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={variant}>{statusInfo}</Badge>
          <Badge variant="outline">{APPROVAL.id}</Badge>
          <Badge variant="outline">{APPROVAL.type}</Badge>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left Column */}
        <div className="flex-1 space-y-6">
          {/* 1. Approval Summary */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<User className="h-3.5 w-3.5" />} title="승인 대상 요약" />
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <InfoRow label="Requester" value={APPROVAL.requester} />
                <InfoRow label="생성일" value={APPROVAL.createdAt} />
                <InfoRow label="Customer" value={APPROVAL.customer} />
                <InfoRow label="Opportunity" value={APPROVAL.opportunity} />
              </div>
            </CardContent>
          </Card>

          {/* 2. Diff Table */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<GitCompare className="h-3.5 w-3.5" />} title="변경 Diff" />
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

          {/* 3. Auto-validation Results */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<ShieldCheck className="h-3.5 w-3.5" />} title="자동 검증 결과" />
            </CardHeader>
            <CardContent>
              {loading === "validate" ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {VALIDATIONS.map((v) => (
                    <div key={v.name} className="flex items-start gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                      <ValidationStatusIcon status={v.status} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{v.name}</span>
                          <Badge variant={v.status === "failed" ? "destructive" : v.status === "warning" ? "secondary" : "default"} className="text-xs">
                            {displayStatus(v.status)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{v.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 4. Failed/Warning Highlight */}
          {failedOrWarningValidations.length > 0 && (
            <Card>
              <CardHeader>
                <SectionHeader icon={<AlertTriangle className="h-3.5 w-3.5" />} title="실패/경고 항목" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {failedOrWarningValidations.map((v) => (
                    <div
                      key={v.name}
                      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
                        v.status === "failed"
                          ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
                          : "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800"
                      }`}
                    >
                      <ValidationStatusIcon status={v.status} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{v.name}</span>
                          <Badge variant={v.status === "failed" ? "destructive" : "secondary"} className="text-xs">
                            {displayStatus(v.status)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{v.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 5. Revenue & Margin */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<DollarSign className="h-3.5 w-3.5" />} title="예상 매출/마진" />
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

          {/* 6. Related Artifacts */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<FileText className="h-3.5 w-3.5" />} title="관련 Artifact" />
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
                    <Badge variant="outline" className="text-xs">{a.type}</Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 7. AI Generation Status */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<Brain className="h-3.5 w-3.5" />} title="AI 생성 여부" />
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

        {/* Right Column */}
        <div className="w-full shrink-0 space-y-6 lg:w-96">
          {/* 1. Color Agent Review */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<Activity className="h-3.5 w-3.5" />} title="Color Agent Review" />
            </CardHeader>
            <CardContent className="space-y-2">
              {COLOR_REVIEWS.map((cr) => {
                const agentKey = cr.color.toLowerCase();
                return (
                  <div key={cr.color} className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <ColorStatusIcon status={cr.status} />
                      <div>
                        <p className="text-sm font-medium">{cr.label}</p>
                        <p className="text-xs text-muted-foreground">{cr.desc}</p>
                      </div>
                    </div>
                    <ColorReviewBadge agent={agentKey} status={cr.status} size="sm" />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* 2. Reviewer Comments */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<MessageSquare className="h-3.5 w-3.5" />} title="담당자 의견" />
            </CardHeader>
            <CardContent>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add your review comments here..."
                rows={4}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </CardContent>
          </Card>

          {/* 3. Approval History */}
          <Card>
            <CardHeader>
              <SectionHeader icon={<History className="h-3.5 w-3.5" />} title="승인 이력" />
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
                        <span className="text-xs text-muted-foreground">{event.timestamp}</span>
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

      {/* Bottom Action Bar */}
      {canAct && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Dialog open={requestChangesOpen} onOpenChange={setRequestChangesOpen}>
              <DialogTrigger render={<Button variant="secondary" size="sm"><MessageSquare className="h-3.5 w-3.5" />Request Changes</Button>} />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Request Changes</DialogTitle>
                  <DialogDescription>Provide feedback for the requester to address.</DialogDescription>
                </DialogHeader>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Describe what needs to change..."
                  rows={4}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRequestChangesOpen(false)}>Cancel</Button>
                  <Button
                    variant="secondary"
                    disabled={loading === "request-changes"}
                    onClick={() => handleAction("Changes requested")}
                  >
                    {loading === "request-changes" ? "Submitting..." : "Submit Request"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={escalateOpen} onOpenChange={setEscalateOpen}>
              <DialogTrigger render={<Button variant="outline" size="sm"><ArrowUpCircle className="h-3.5 w-3.5" />Escalate</Button>} />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Escalate Approval</DialogTitle>
                  <DialogDescription>Send this approval to a higher authority for review.</DialogDescription>
                </DialogHeader>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Reason for escalation..."
                  rows={4}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEscalateOpen(false)}>Cancel</Button>
                  <Button
                    variant="default"
                    disabled={loading === "escalate"}
                    onClick={() => handleAction("Escalated")}
                  >
                    {loading === "escalate" ? "Escalating..." : "Confirm Escalation"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Separator orientation="vertical" className="h-6 hidden sm:block" />

            <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <DialogTrigger render={<Button variant="destructive" size="sm">Reject</Button>} />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reject approval</DialogTitle>
                  <DialogDescription>Are you sure you want to reject this approval? This will notify the requester.</DialogDescription>
                </DialogHeader>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Reason for rejection..."
                  rows={3}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
                  <Button
                    variant="destructive"
                    disabled={loading === "reject"}
                    onClick={() => handleAction("Rejected")}
                  >
                    {loading === "reject" ? "Rejecting..." : "Confirm Reject"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
              <DialogTrigger render={<Button size="sm">Approve</Button>} />
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
                  <Button
                    disabled={loading === "approve"}
                    onClick={() => handleAction("Approved")}
                  >
                    {loading === "approve" ? "Approving..." : "Confirm Approval"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      )}
    </div>
  );
}
