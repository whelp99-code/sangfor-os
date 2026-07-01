"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

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
  candidatesByType: { candidateType: string; status: string; _count: number }[];
};

function ThreadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      className="h-4 w-4 text-muted-foreground"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function ClassifyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      className="h-4 w-4 text-muted-foreground"
    >
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function ApprovedIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      className="h-4 w-4 text-muted-foreground"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function StatCard({
  title,
  value,
  note,
  icon,
  loading,
}: {
  title: string;
  value: number | null;
  note: string;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-8 w-16 animate-pulse rounded bg-muted" />
        ) : (
          <div className="text-2xl font-bold">{value === null ? "—" : value.toLocaleString()}</div>
        )}
        <p className="text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

export default function MailIntelligencePage() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/daily-report");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setReport(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "알 수 없는 오류");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Total candidates across all type/status buckets (real DB groupBy count).
  const totalCandidates = report
    ? report.candidatesByType.reduce((sum, c) => sum + c._count, 0)
    : null;

  // Converted entities = candidates whose lifecycle reached "converted".
  const convertedTotal = report
    ? report.candidatesByType
        .filter((c) => c.status === "converted")
        .reduce((sum, c) => sum + c._count, 0)
    : null;

  const entityBreakdown = report
    ? `고객 ${report.entities.customers} · 파트너 ${report.entities.partners} · 기회 ${report.entities.opportunities} · 작업 ${report.entities.tasks}`
    : "집계 예정";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">메일 인텔리전스</h1>
          <p className="text-muted-foreground">
            AI 기반 메일 분석 및 비즈니스 인사이트 추출
          </p>
        </div>
        <Link
          href="/development/mail-candidates"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          메일 후보 관리 →
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          통계를 불러오지 못했습니다: {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="총 메일 후보"
          value={totalCandidates}
          note="전체 후보 누적"
          icon={<ThreadIcon />}
          loading={loading}
        />
        <StatCard
          title="승인 대기"
          value={report ? report.mail.pendingApproval : null}
          note="proposed 상태"
          icon={<ClassifyIcon />}
          loading={loading}
        />
        <StatCard
          title="오늘 승인"
          value={report ? report.mail.todayApproved : null}
          note="오늘 승인된 후보"
          icon={<ApprovedIcon />}
          loading={loading}
        />
        <StatCard
          title="변환된 엔티티"
          value={convertedTotal}
          note={entityBreakdown}
          icon={<ThreadIcon />}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>빠른 링크</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              href="/development/mail-candidates"
              className="flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            >
              📧 메일 후보 관리
            </Link>
            <Link
              href="/approvals/mail-candidates"
              className="flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            >
              ✅ 메일 후보 승인
            </Link>
            <Link
              href="/customers"
              className="flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            >
              👥 고객 관리
            </Link>
            <Link
              href="/partners"
              className="flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            >
              🤝 파트너 관리
            </Link>
            <Link
              href="/opportunities"
              className="flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            >
              💼 영업 기회 관리
            </Link>
            <Link
              href="/tasks"
              className="flex items-center rounded-lg border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
            >
              📋 작업 관리
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>오늘 처리 현황</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-8 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : report ? (
              <div className="space-y-3">
                <ActivityRow label="오늘 생성된 후보" value={report.mail.todayCandidates} unit="건" />
                <ActivityRow label="오늘 승인 완료" value={report.mail.todayApproved} unit="건" />
                <ActivityRow label="오늘 엔티티 변환" value={report.mail.todayConverted} unit="건" />
                {report.mail.todayCandidates === 0 &&
                report.mail.todayApproved === 0 &&
                report.mail.todayConverted === 0 ? (
                  <p className="pt-1 text-xs text-muted-foreground">
                    오늘 처리된 메일 후보가 없습니다.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">데이터 없음</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ActivityRow({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">
        {value.toLocaleString()}
        {unit}
      </span>
    </div>
  );
}
