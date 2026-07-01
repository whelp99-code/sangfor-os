import { listImprovementCandidates } from "@sangfor/business/improvement-loop";
import Link from "next/link";

import { ImprovementCandidateActions } from "@/components/development/improvement-candidate-actions";
import { CreateImprovementForm } from "@/components/development/create-improvement-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PageProps = {
  searchParams: Promise<{ status?: string; severity?: string }>;
};

export default async function ImprovementsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const candidates = await listImprovementCandidates({
    status: params.status as
      | "proposed"
      | "approved"
      | "rejected"
      | "converted"
      | undefined,
    severity: params.severity as
      | "low"
      | "medium"
      | "high"
      | "critical"
      | undefined,
    limit: 50,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            개선 후보
          </h1>
          <p className="text-muted-foreground">
            Phase 15 자기 개선 루프 — 오류를 승인된 Phase 13 실행으로 전환합니다.
          </p>
        </div>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/development">
          개발 센터로 돌아가기
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>오류에서 생성</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateImprovementForm />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/development/improvements">
          전체
        </Link>
        <Link
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          href="/development/improvements?status=proposed"
        >
          제안됨
        </Link>
        <Link
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          href="/development/improvements?status=approved"
        >
          승인됨
        </Link>
        <Link
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          href="/development/improvements?status=converted"
        >
          전환됨
        </Link>
      </div>

      <div className="grid gap-3">
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            아직 개선 후보가 없습니다. 위의 &ldquo;오류에서 생성&rdquo;으로 첫 후보를 등록해 보세요.
          </p>
        ) : (
          candidates.map((candidate) => (
            <Card key={candidate.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-base">{candidate.title}</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{candidate.status}</Badge>
                    <Badge variant="secondary">{candidate.severity}</Badge>
                    <Badge variant="outline">{candidate.sourceType}</Badge>
                  </div>
                </div>
                <ImprovementCandidateActions
                  candidateId={candidate.id}
                  status={candidate.status}
                  commandRunId={candidate.commandRunId}
                />
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                  {candidate.summary}
                </pre>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
