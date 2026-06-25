"use client";

import { useEffect, useState } from "react";
import {
  Mail,
  Users,
  Handshake,
  ListChecks,
  TrendingUp,
  CheckCircle2,
  Clock,
  ArrowRight,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type DailyReport = {
  date: string;
  mail: {
    todayCandidates: number;
    pendingApproval: number;
    todayApproved: number;
    todayConverted: number;
  };
  entities: {
    customers: number;
    partners: number;
    tasks: number;
    opportunities: number;
  };
};

type PendingCandidate = {
  id: string;
  candidateType: string;
  title: string;
  confidence: number;
  status: string;
};

export function DailyReportSection() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [pendingCandidates, setPendingCandidates] = useState<PendingCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [reportRes, candidatesRes] = await Promise.all([
          fetch("/api/daily-report"),
          fetch("/api/mail-candidates?status=proposed"),
        ]);
        if (reportRes.ok) {
          setReport(await reportRes.json());
        }
        if (candidatesRes.ok) {
          const data = await candidatesRes.json();
          setPendingCandidates(Array.isArray(data) ? data.slice(0, 10) : []);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  async function handleAction(id: string, action: "approve" | "reject") {
    try {
      await fetch(`/api/mail-candidates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: action === "approve" ? "approved" : "rejected",
        }),
      });
      setPendingCandidates((prev) => prev.filter((c) => c.id !== id));
    } catch {
      // silently fail
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          일일 보고를 불러오는 중…
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {report && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">📊 일일 보고</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Mail Status */}
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
                  <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <CardTitle className="text-sm font-medium">
                  메일 처리 현황
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <ReportStat
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="오늘 신규"
                    value={report.mail.todayCandidates}
                    unit="건"
                    color="blue"
                  />
                  <ReportStat
                    icon={<Mail className="h-3.5 w-3.5" />}
                    label="승인 대기"
                    value={report.mail.pendingApproval}
                    unit="건"
                    color="amber"
                  />
                  <ReportStat
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    label="오늘 승인"
                    value={report.mail.todayApproved}
                    unit="건"
                    color="emerald"
                  />
                  <ReportStat
                    icon={<ArrowRight className="h-3.5 w-3.5" />}
                    label="오늘 변환"
                    value={report.mail.todayConverted}
                    unit="건"
                    color="purple"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Entity Status */}
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/50">
                  <TrendingUp className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                </div>
                <CardTitle className="text-sm font-medium">
                  생성된 엔티티
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <ReportStat
                    icon={<Users className="h-3.5 w-3.5" />}
                    label="고객"
                    value={report.entities.customers}
                    unit="개"
                    color="blue"
                  />
                  <ReportStat
                    icon={<Handshake className="h-3.5 w-3.5" />}
                    label="파트너"
                    value={report.entities.partners}
                    unit="개"
                    color="emerald"
                  />
                  <ReportStat
                    icon={<ListChecks className="h-3.5 w-3.5" />}
                    label="작업"
                    value={report.entities.tasks}
                    unit="개"
                    color="amber"
                  />
                  <ReportStat
                    icon={<TrendingUp className="h-3.5 w-3.5" />}
                    label="기회"
                    value={report.entities.opportunities}
                    unit="개"
                    color="purple"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {pendingCandidates.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">✅ 승인 요청</h2>
            <Badge variant="secondary" className="text-xs">
              {pendingCandidates.length}건
            </Badge>
          </div>
          <div className="grid gap-2">
            {pendingCandidates.map((candidate) => (
              <div
                key={candidate.id}
                className="group flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 transition-all hover:shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="shrink-0 text-[11px]">
                    {candidate.candidateType}
                  </Badge>
                  <span className="text-sm">{candidate.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {candidate.confidence}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAction(candidate.id, "approve")}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
                  >
                    승인
                  </button>
                  <button
                    onClick={() => handleAction(candidate.id, "reject")}
                    className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50"
                  >
                    거부
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const STAT_COLORS = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
  emerald:
    "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
  amber:
    "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400",
  purple:
    "bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400",
} as const;

function ReportStat({
  icon,
  label,
  value,
  unit,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  unit: string;
  color: keyof typeof STAT_COLORS;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/30 p-2.5">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${STAT_COLORS[color]}`}
      >
        {icon}
      </div>
      <div>
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {label} {unit}
        </p>
      </div>
    </div>
  );
}
