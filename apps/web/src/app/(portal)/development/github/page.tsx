export const dynamic = "force-dynamic";

import { prisma } from "@sangfor/db";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

export default async function DevelopmentGitHubPage() {
  const [issues, pullRequests] = await Promise.all([
    prisma.gitHubIssue.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.pullRequest.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">GitHub Sync</h1>
          <p className="text-muted-foreground">Issues and pull requests tracked from automation runs.</p>
        </div>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/development">
          Back to Development
        </Link>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Issues</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {issues.length === 0 ? (
              <p className="text-muted-foreground">No issues synced yet.</p>
            ) : (
              issues.map((issue) => (
                <div key={issue.id} className="flex justify-between gap-2">
                  <span>#{issue.number} {issue.title}</span>
                  <Badge variant="outline">{issue.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Pull Requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {pullRequests.length === 0 ? (
              <p className="text-muted-foreground">No PRs synced yet.</p>
            ) : (
              pullRequests.map((pr) => (
                <div key={pr.id} className="flex justify-between gap-2">
                  <span>#{pr.number} {pr.title}</span>
                  <Badge variant="outline">{pr.ciStatus ?? pr.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
