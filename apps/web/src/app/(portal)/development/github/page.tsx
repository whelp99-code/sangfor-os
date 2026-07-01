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
          <h1 className="text-2xl font-semibold tracking-tight">GitHub 동기화</h1>
          <p className="text-muted-foreground">자동화 실행에서 추적된 이슈와 풀 리퀘스트.</p>
        </div>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/development">
          개발 센터로 돌아가기
        </Link>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>이슈</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {issues.length === 0 ? (
              <p className="text-muted-foreground">아직 동기화된 이슈가 없습니다.</p>
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
            <CardTitle>풀 리퀘스트</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {pullRequests.length === 0 ? (
              <p className="text-muted-foreground">아직 동기화된 PR이 없습니다.</p>
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
