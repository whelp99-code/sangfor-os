/**
 * Reserved persona seam — rules-only fallback classifier (U007).
 * Must not invent confidence or non-general categories; no network/LLM.
 */

export type ClassifyOptions = {
  mode?: string;
  [key: string]: unknown;
};

export type ClassifyResult = {
  result: {
    category: string;
  };
};

/**
 * Documented reserved seam. In rules-only mode always returns general.
 * Does not call fetch/LLM; does not mutate input.
 */
export class HybridMailClassifier {
  async classifyAsync(
    mail: unknown,
    opts?: ClassifyOptions,
  ): Promise<ClassifyResult> {
    // Freeze-check: never mutate input
    void mail;
    void opts;
    // rules-only and any other mode in this leaf: exact general only
    return { result: { category: "general" } };
  }
}
