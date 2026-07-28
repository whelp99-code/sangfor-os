import { prisma } from "@sangfor/db";
import { engineerConsole, type RagHit } from "@sangfor/infra";
import { assembleRagContext, runDomainStage, type DomainCase, type RagContextHit } from "@sangfor/business";
import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/engineer/domain-proposal/route.ts");
  if (capabilityDenied) return capabilityDenied;

  let body: { caseId?: unknown; product?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
  if (!caseId) return Response.json({ error: "caseId is required" }, { status: 400 });

  const supportCase = await prisma.supportCase.findUnique({ where: { id: caseId } });
  if (!supportCase) return Response.json({ error: "case not found" }, { status: 404 });

  const product = typeof body.product === "string" ? body.product : undefined;

  let ragHits: RagHit[] = [];
  try {
    const result = await engineerConsole.ragSearch({ query: supportCase.subject, product, limit: 5 });
    ragHits = result.results ?? [];
  } catch {
    ragHits = [];
  }

  const ragChunks: RagContextHit[] = ragHits.map((hit) => ({
    title: typeof hit.title === "string" ? hit.title : undefined,
    text: hit.text,
    source: hit.source,
  }));
  const ragContext = assembleRagContext(ragChunks);
  const ragSources = ragChunks
    .slice(0, 3)
    .map((hit) => hit.source ?? hit.title)
    .filter((source): source is string => typeof source === "string");

  const domainCase: DomainCase = {
    id: supportCase.id,
    subject: supportCase.subject,
    tags: [],
    content: ragContext ? `${supportCase.subject}\n\n${ragContext}` : supportCase.subject,
  };

  const stageResult = await runDomainStage("engineer", domainCase, {});

  return Response.json({ proposal: stageResult.artifact, ragSources });
}
