import { prisma } from "@ai-portal/db";
import { z } from "zod";

const CHUNK_SIZE = 500;

export const searchKnowledgeSchema = z.object({
  projectSlug: z.string().default("demo-project"),
  q: z.string().min(1),
});

export const createKnowledgeSchema = z.object({
  projectSlug: z.string().default("demo-project"),
  title: z.string().min(2),
  body: z.string().min(1),
  tags: z.array(z.string()).default([]),
  source: z.string().default("manual"),
});

export const updateKnowledgeSchema = z.object({
  title: z.string().min(2).optional(),
  body: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
});

async function resolveProjectId(slug: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

function chunkBody(body: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += CHUNK_SIZE) {
    chunks.push(body.slice(i, i + CHUNK_SIZE));
  }
  return chunks.length ? chunks : [body];
}

export async function syncKnowledgeChunks(documentId: string) {
  const doc = await prisma.knowledgeDocument.findUniqueOrThrow({
    where: { id: documentId },
  });
  await prisma.knowledgeChunk.deleteMany({ where: { documentId } });
  const parts = chunkBody(doc.body);
  await prisma.knowledgeChunk.createMany({
    data: parts.map((content, chunkIndex) => ({
      documentId,
      chunkIndex,
      content,
    })),
  });
}

export async function createKnowledgeDocument(input: z.infer<typeof createKnowledgeSchema>) {
  const parsed = createKnowledgeSchema.parse(input);
  const projectId = await resolveProjectId(parsed.projectSlug);
  const doc = await prisma.knowledgeDocument.create({
    data: {
      projectId,
      title: parsed.title,
      body: parsed.body,
      tags: parsed.tags,
      source: parsed.source,
    },
  });
  await syncKnowledgeChunks(doc.id);
  return doc;
}

export type KnowledgeCitation = {
  documentId: string;
  title: string;
  chunkIndex: number;
  excerpt: string;
  source: string;
};

export async function searchKnowledgeWithCitations(
  input: z.infer<typeof searchKnowledgeSchema>,
): Promise<KnowledgeCitation[]> {
  const parsed = searchKnowledgeSchema.parse(input);
  const projectId = await resolveProjectId(parsed.projectSlug);
  const q = parsed.q.toLowerCase();

  const chunks = await prisma.knowledgeChunk.findMany({
    where: {
      document: { projectId },
      content: { contains: parsed.q, mode: "insensitive" },
    },
    include: { document: true },
    take: 20,
  });

  if (chunks.length > 0) {
    return chunks.map((c) => ({
      documentId: c.documentId,
      title: c.document.title,
      chunkIndex: c.chunkIndex,
      excerpt: c.content.slice(0, 200),
      source: c.document.source,
    }));
  }

  const docs = await prisma.knowledgeDocument.findMany({
    where: {
      projectId,
      OR: [
        { title: { contains: parsed.q, mode: "insensitive" } },
        { body: { contains: parsed.q, mode: "insensitive" } },
        { tags: { has: q } },
      ],
    },
    take: 10,
  });

  return docs.map((d) => ({
    documentId: d.id,
    title: d.title,
    chunkIndex: 0,
    excerpt: d.body.slice(0, 200),
    source: d.source,
  }));
}

export async function searchKnowledge(input: z.infer<typeof searchKnowledgeSchema>) {
  const citations = await searchKnowledgeWithCitations(input);
  const ids = [...new Set(citations.map((c) => c.documentId))];
  if (ids.length === 0) return [];
  return prisma.knowledgeDocument.findMany({
    where: { id: { in: ids } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function buildContextPack(
  query: string,
  projectSlug = "demo-project",
  limit = 5,
): Promise<string> {
  const citations = await searchKnowledgeWithCitations({
    projectSlug,
    q: query,
  });
  if (citations.length === 0) return "";
  return citations
    .slice(0, limit)
    .map(
      (c, i) =>
        `[${i + 1}] ${c.title} (chunk ${c.chunkIndex}, ${c.source})\n${c.excerpt}`,
    )
    .join("\n\n");
}

export async function listKnowledgeDocuments(projectSlug = "demo-project") {
  const projectId = await resolveProjectId(projectSlug);
  return prisma.knowledgeDocument.findMany({
    where: { projectId },
    orderBy: { title: "asc" },
    include: { _count: { select: { chunks: true } } },
  });
}

export async function getKnowledgeDocument(id: string) {
  return prisma.knowledgeDocument.findUnique({
    where: { id },
    include: { _count: { select: { chunks: true } } },
  });
}

export async function updateKnowledgeDocument(
  id: string,
  input: z.infer<typeof updateKnowledgeSchema>,
) {
  const parsed = updateKnowledgeSchema.parse(input);
  const doc = await prisma.knowledgeDocument.update({
    where: { id },
    data: parsed,
  });
  if (parsed.body !== undefined) {
    await syncKnowledgeChunks(doc.id);
  }
  return getKnowledgeDocument(doc.id);
}

export async function seedKnowledgeDemo(projectSlug = "demo-project") {
  const projectId = await resolveProjectId(projectSlug);
  const count = await prisma.knowledgeDocument.count({ where: { projectId } });
  if (count > 0) return { seeded: false };

  const doc = await createKnowledgeDocument({
    projectSlug,
    title: "Sangfor HCI Overview",
    body: "Hyper-converged infrastructure product line for enterprise virtualization.",
    tags: ["sangfor", "hci", "product"],
    source: "seed",
  });
  await createKnowledgeDocument({
    projectSlug,
    title: "PoC Success Criteria Template",
    body: "Define measurable outcomes, timeline, and stakeholder sign-off before PoC kickoff.",
    tags: ["poc", "template"],
    source: "seed",
  });
  return { seeded: true, docId: doc.id };
}
