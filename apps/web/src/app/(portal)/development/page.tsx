export const dynamic = "force-dynamic";

import Link from "next/link";

import { listDevActivity } from "@ai-portal/automation";
import { prisma } from "@ai-portal/db";

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
        title="Development Center"
        description="Branches, code changes, builds, and test runs from the dev automation engine."
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
            <CardTitle className="text-sm font-medium">Open PRs</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{prCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Build runs</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{buildCount}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Recent changes</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{changes.length}</CardContent>
        </Card>
      </div>
      <div className="grid gap-3">
        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No code changes recorded yet.</p>
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
