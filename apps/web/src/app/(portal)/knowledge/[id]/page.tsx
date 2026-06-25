import { getKnowledgeDocument } from "@sangfor/business/knowledge-search";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EditKnowledgeForm } from "@/components/knowledge/edit-knowledge-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PageProps = { params: Promise<{ id: string }> };

export default async function KnowledgeDetailPage({ params }: PageProps) {
  const { id } = await params;
  const document = await getKnowledgeDocument(id);
  if (!document) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/knowledge" className="text-sm text-muted-foreground hover:underline">
          ← Back to knowledge
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{document.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {document.tags.map((tag) => (
            <Badge key={tag} variant="outline">{tag}</Badge>
          ))}
          <Badge variant="secondary">{document._count.chunks} chunks</Badge>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>Edit document</CardTitle></CardHeader>
        <CardContent>
          <EditKnowledgeForm
            documentId={document.id}
            initial={{
              title: document.title,
              body: document.body,
              tags: document.tags,
              source: document.source,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
