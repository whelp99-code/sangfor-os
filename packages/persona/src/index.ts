export class HybridMailClassifier {
  async classifyAsync(mail: unknown, opts?: { mode?: string }): Promise<{ result: { category: string } }> {
    return { result: { category: "general" } }
  }
}
