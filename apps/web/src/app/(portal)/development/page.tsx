export const dynamic = "force-dynamic";

import Link from "next/link";

import { listDevActivity } from "@sangfor/business";
import { prisma } from "@sangfor/db";

import { RegistryPageView } from "@/components/registry/registry-page-view";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const DEV_LINKS = [
  { href: "/development/orchestrator", label: "Orchestrator" },
  { href: "/development/improvements", label: "Improvements" },
  { href: "/development/mail-candidates", label: "Mail Candidates" },
  { href: "/development/codex-tasks", label: "Codex Tasks" },
  { href: "/development/cursor-sessions", label: "Cursor Sessions" },
  { href: "/development/github", label: "GitHub Sync" },
] as const;

export default async function DevelopmentCenterPage() {
  const [changes, prCount, buildCount] = await Promise.all([
    listDevActivity(),
    prisma.pullRequest.count({ where: { status: "open" } }),
    prisma.buildRun.count(),
  ]);

  return (
    <div className="space-y-6">
      <RegistryPageView
        pageKey="development"
        title="개발 센터"
        description="개발 자동화 엔진의 브랜치, 코드 변경, 빌드, 테스트 실행 현황."
      />
      <div className="flex flex-wrap gap-2">
        {DEV_LINKS.map((link) => (
          <Link
            key={link.href}
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href={link.href}
          >
            {link.label}
          </Link>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">열린 PR</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{prCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">빌드 실행</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{buildCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">최근 변경</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{changes.length}</CardContent>
        </Card>
      </div>
      <div className="grid gap-3">
        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 기록된 코드 변경이 없습니다.</p>
        ) : (
          changes.map((change) => (
            <Card key={change.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{change.summary}</CardTitle>
                <Badge variant="outline">
                  {change.buildRuns[0]?.testRuns[0]?.status ?? "pending"}
                </Badge>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {change.changedFiles.length} files · build:{" "}
                {change.buildRuns[0]?.status ?? "—"}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
