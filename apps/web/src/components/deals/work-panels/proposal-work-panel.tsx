import Link from "next/link";
import { FileText, ExternalLink, PlusCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-date";

// ---------------------------------------------------------------------------
// Minimal GeneratedDocument shape — only what ProposalWorkPanel needs.
// Avoids importing @prisma/client in a component that may be used as Server.
// ---------------------------------------------------------------------------
export type GeneratedDocumentSummary = {
  id: string;
  title: string;
  status: string;
  createdAt: Date | string;
  opportunityId: string | null;
  bodyMarkdown: string;
  customer: { name: string } | null;
  template: { templateKey: string; title: string } | null;
};

type ProposalWorkPanelProps = {
  opportunityId: string;
  opportunityTitle: string;
  proposals: GeneratedDocumentSummary[];
};

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------
const STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  approved: "승인",
  archived: "보관",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  approved: "default",
  archived: "secondary",
};


// ---------------------------------------------------------------------------
// ProposalWorkPanel
// ---------------------------------------------------------------------------

/**
 * Stage ① (제안) work surface.
 *
 * Shows only proposals already linked to this opportunity (matched by
 * opportunityId). When none are linked, renders an empty state — it never
 * falls back to unrelated proposals from other deals.
 * Surfaces a link to the existing /proposals generate flow — does NOT
 * rebuild generation logic.
 */
export function ProposalWorkPanel({
  opportunityId,
  opportunityTitle,
  proposals,
}: ProposalWorkPanelProps) {
  // Only show proposals linked to THIS opportunity — no cross-deal fallback.
  const linked = proposals.filter((p) => p.opportunityId === opportunityId);
  const displayDocs = linked;

  return (
    <div className="space-y-4">
      {/* --- Document work area header --- */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-base font-bold">제안서</h2>
          {linked.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {linked.length}개
            </Badge>
          )}
        </div>
        <Link
          href="/proposals"
          className={cn(buttonVariants({ size: "sm", variant: "outline" }), "gap-1.5")}
        >
          <PlusCircle className="size-3.5" aria-hidden="true" />
          제안서 생성
        </Link>
      </div>

      {/* --- Proposal list (existing documents) --- */}
      {displayDocs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto mb-2 size-8 opacity-40" aria-hidden="true" />
            <p>이 딜에 연결된 제안서가 없습니다.</p>
            <p className="mt-1">
              <Link
                href="/proposals"
                className="text-primary underline-offset-4 hover:underline"
              >
                제안서 생성 페이지에서 새 제안서를 만드세요.
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {displayDocs.map((doc) => (
            <ProposalDocCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}

      {/* --- Proposal document preview area (body of first linked doc) --- */}
      {linked.length > 0 && linked[0] ? (
        <ProposalPreviewArea
          doc={linked[0]}
          opportunityTitle={opportunityTitle}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposal document card (list item)
// ---------------------------------------------------------------------------
function ProposalDocCard({ doc }: { doc: GeneratedDocumentSummary }) {
  const statusLabel = STATUS_LABEL[doc.status] ?? doc.status;
  const statusVariant = STATUS_VARIANT[doc.status] ?? "outline";

  return (
    <Card className="transition-colors hover:bg-muted/30">
      <CardContent className="flex items-center gap-3 py-3">
        <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-sm">{doc.title}</span>
            <Badge variant={statusVariant} className="shrink-0 text-xs">
              {statusLabel}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            {doc.customer ? <span>{doc.customer.name}</span> : null}
            {doc.template ? <span>{doc.template.title}</span> : null}
            <span>{formatDate(doc.createdAt)}</span>
          </div>
        </div>
        <Link
          href={`/proposals/${doc.id}`}
          className={cn(buttonVariants({ size: "icon", variant: "ghost" }), "shrink-0")}
          aria-label="제안서 열기"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Proposal preview area (body preview of primary document, mockup 05 style)
// ---------------------------------------------------------------------------
function ProposalPreviewArea({
  doc,
  opportunityTitle,
}: {
  doc: GeneratedDocumentSummary;
  opportunityTitle: string;
}) {
  // Show first ~600 chars of the body as a preview; real editing in /proposals/[id]
  const preview = doc.bodyMarkdown.slice(0, 600);
  const isTruncated = doc.bodyMarkdown.length > 600;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="font-bold">{doc.title || `${opportunityTitle} 제안서`}</span>
          <div className="flex items-center gap-2">
            <Link
              href={`/proposals/${doc.id}`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              전체 편집
            </Link>
            <Link
              href={`/proposals/${doc.id}`}
              className={buttonVariants({ size: "sm" })}
            >
              저장
            </Link>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Toolbar stub (read-only preview; full editing at /proposals/[id]) */}
        <div
          className="mb-3 flex flex-wrap gap-1 rounded-md border px-2 py-1.5 text-xs text-muted-foreground"
          aria-label="편집 도구 모음 (전체 편집 페이지에서 사용 가능)"
        >
          {["B", "I", "제목", "표", "이미지", "|", "정렬", "목록", "링크"].map((item) => (
            <span
              key={item}
              className="rounded px-1.5 py-0.5 font-semibold"
              aria-hidden="true"
            >
              {item}
            </span>
          ))}
        </div>

        {/* Body preview */}
        <div
          className="min-h-48 rounded-md border bg-muted/20 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
          aria-label="제안서 본문 미리보기"
        >
          {preview}
          {isTruncated && (
            <span className="text-muted-foreground">
              {" "}…{" "}
              <Link href={`/proposals/${doc.id}`} className="text-primary underline-offset-4 hover:underline">
                전체 보기
              </Link>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
