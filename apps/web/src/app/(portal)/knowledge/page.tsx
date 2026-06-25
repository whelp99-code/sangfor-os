export const dynamic = "force-dynamic";

import Link from "next/link";
import { listKnowledgeDocuments } from "@ai-portal/automation/knowledge-search";

import { CreateKnowledgeForm } from "@/components/knowledge/create-knowledge-form";
import { KnowledgeSearch } from "@/components/knowledge/knowledge-search";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function KnowledgePage() {
  const documents = await listKnowledgeDocuments();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">지식베이스</h1>
        <p className="text-muted-foreground">Chunked search with citations and context packs.</p>
      </div>
      <KnowledgeSearch />
      <Card>
        <CardHeader><CardTitle>Open-source knowledge stack</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>LightRAG handles optional GraphRAG answers when configured; local database search remains the fallback.</p>
          <p>Status endpoint: <code className="rounded bg-muted px-1 py-0.5">/api/knowledge?status=1</code></p>
          <p>Obsidian vault: <code className="rounded bg-muted px-1 py-0.5">knowledge/wiki</code></p>
          <p>Run OpenKB and Graphify through <code className="rounded bg-muted px-1 py-0.5">pnpm knowledge:*</code> operations scripts.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Add document</CardTitle></CardHeader>
        <CardContent>
          <CreateKnowledgeForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>All documents ({documents.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {documents.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No knowledge base documents registered.</p>
          ) : (
            documents.map((doc) => (
              <div key={doc.id} className="border-b border-border/40 pb-2 last:border-0 last:pb-0">
                <p className="font-medium">
                  <Link href={`/knowledge/${doc.id}`} className="hover:underline">{doc.title}</Link>
                </p>
                <p className="text-muted-foreground line-clamp-2">{doc.body}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{doc._count.chunks} chunks · {doc.source}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
