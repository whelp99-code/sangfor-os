import type { Embedder } from "./domain-embedding";

/**
 * 결정론적 로컬 해시 임베딩 (외부 API 불필요).
 * 토큰을 FNV 해시 → 차원 버킷에 누적 후 L2 정규화. 품질은 낮지만 오프라인/백필/테스트에 충분.
 * 운영에서는 동일한 `Embedder` 시그니처로 실제 임베딩 API(OpenAI/sangfor-rag)를 주입해 교체.
 */
export function createHashEmbedder(dim = 256): Embedder {
  return async (text: string) => {
    const vec = new Array<number>(dim).fill(0);
    const tokens = text.toLowerCase().split(/[^a-z0-9가-힣]+/u).filter(Boolean);
    for (const tok of tokens) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      vec[Math.abs(h) % dim] += 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  };
}

/** 메모리 레코드로부터 임베딩 입력 텍스트를 구성. */
export function embeddingTextFor(input: {
  label: string;
  tags?: string[];
  summary?: string;
}): string {
  return [input.label, (input.tags ?? []).join(" "), input.summary ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
}
