export interface RagContextHit {
  title?: string;
  text?: string;
  source?: string;
}

export interface AssembleRagContextOptions {
  maxChunks?: number;
}

export function assembleRagContext(
  hits: RagContextHit[],
  opts: AssembleRagContextOptions = {},
): string {
  const maxChunks = opts.maxChunks ?? 3;
  return hits
    .slice(0, maxChunks)
    .map((hit) => `[출처: ${hit.source ?? hit.title ?? "unknown"}]\n${hit.text ?? ""}`)
    .join("\n\n");
}
