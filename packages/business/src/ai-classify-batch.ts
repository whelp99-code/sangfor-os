/**
 * AI batch-classification primitives:
 *   - withBackoff: exponential-backoff retry wrapper
 *   - mapPool: bounded-concurrency pool with per-item error capture
 *   - GROUND_TRUTH_CALIBRATION: human-confirmed classification reference
 *   - reclassifyDomainsWithAI: higher-level domain reclassify orchestrator
 */

// ---------------------------------------------------------------------------
// BackoffOpts / withBackoff
// ---------------------------------------------------------------------------

export interface BackoffOpts {
  retries?: number; // default 4
  baseMs?: number; // default 500
  isRetryable?: (e: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

function defaultIsRetryable(e: unknown): boolean {
  if (e instanceof Error) {
    const msg = e.message;
    return (
      msg.includes("429") ||
      msg.includes("timeout") ||
      msg.includes("rate") ||
      msg.includes("ECONNRESET") ||
      msg.includes("503") ||
      msg.includes("502")
    );
  }
  return false;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts?: BackoffOpts,
): Promise<T> {
  const retries = opts?.retries ?? 4;
  const baseMs = opts?.baseMs ?? 500;
  const isRetryable = opts?.isRetryable ?? defaultIsRetryable;
  const sleep = opts?.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isRetryable(e)) {
        throw e;
      }
      if (attempt < retries) {
        await sleep(baseMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// mapPool
// ---------------------------------------------------------------------------

export async function mapPool<I, O>(
  items: I[],
  concurrency: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<Array<{ ok: true; value: O } | { ok: false; error: string }>> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<{ ok: true; value: O } | { ok: false; error: string }>(
    items.length,
  );
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      try {
        const value = await worker(items[current], current);
        results[current] = { ok: true, value };
      } catch (e) {
        results[current] = { ok: false, error: String(e) };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );
  return results;
}

// ---------------------------------------------------------------------------
// GROUND_TRUTH_CALIBRATION
// ---------------------------------------------------------------------------

export const GROUND_TRUTH_CALIBRATION: string =
  "고객=우리가 파는 최종 사용자(자사 인프라 도입/구축/갱신). 파트너=총판/리셀러/SI/공급사 또는 제3 엔드고객용 채널 — 한국 IT/SI/솔루션(.co.kr 등) 업체는 증거가 모호하면 vendor/제외가 아니라 partner로 분류. vendor=우리가 쓰는 글로벌 SaaS/툴/은행/뉴스/항공(Notion·Anthropic·Slack·Atlassian·ECOUNT·WEHAGO·팝빌·모두싸인 등). 확신 없으면 needsHuman.";

// ---------------------------------------------------------------------------
// DomainClassifyResult / reclassifyDomainsWithAI
// ---------------------------------------------------------------------------

export interface DomainClassifyResult {
  domain: string;
  type: string;
  confidence: number;
  needsHuman?: boolean;
}

export async function reclassifyDomainsWithAI(
  domains: string[],
  classifyOne: (domain: string) => Promise<DomainClassifyResult>,
  opts?: { concurrency?: number; _backoffOpts?: BackoffOpts },
): Promise<{ results: DomainClassifyResult[]; failed: string[] }> {
  const concurrency = opts?.concurrency ?? 2;
  const backoffOpts = opts?._backoffOpts;

  const poolResults = await mapPool(domains, concurrency, (domain) =>
    withBackoff(() => classifyOne(domain), backoffOpts),
  );

  const results: DomainClassifyResult[] = [];
  const failed: string[] = [];

  for (let i = 0; i < domains.length; i++) {
    const r = poolResults[i];
    if (r.ok) {
      results.push(r.value);
    } else {
      failed.push(domains[i]);
    }
  }

  return { results, failed };
}
