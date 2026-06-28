/**
 * @sangfor/infra — resilience primitives: retry with backoff + circuit breaker.
 * Both are dependency-injected (clock/sleep) so they are deterministic in tests.
 */

/** HTTP status error — lets callers distinguish 4xx/5xx from network failures. */
export class HttpStatusError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
    this.name = "HttpStatusError";
  }
}

export interface RetryOptions {
  /** Number of retries after the first attempt. Default 2. */
  retries?: number;
  /** Base backoff in ms (exponential). Default 0 (no delay). */
  baseDelayMs?: number;
  /** Decide whether an error is retryable. Default: retry everything except 4xx. */
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** Default: retry network errors and 5xx; never retry 4xx. */
export function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof HttpStatusError) return error.status >= 500;
  return true;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 0;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error)) break;
      if (baseDelayMs > 0) await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive failures before opening. Default 5. */
  threshold?: number;
  /** How long the circuit stays open before a half-open trial. Default 30s. */
  cooldownMs?: number;
  now?: () => number;
}

/**
 * Minimal circuit breaker. Opens after `threshold` consecutive failures and
 * rejects fast until `cooldownMs` elapses, then allows one half-open trial.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private open = false;

  constructor(private readonly opts: CircuitBreakerOptions = {}) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  get state(): CircuitState {
    if (!this.open) return "closed";
    const cooldown = this.opts.cooldownMs ?? 30_000;
    return this.now() - this.openedAt >= cooldown ? "half-open" : "open";
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      throw new Error("circuit open");
    }
    try {
      const result = await fn();
      this.failures = 0;
      this.open = false;
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= (this.opts.threshold ?? 5)) {
        this.open = true;
        this.openedAt = this.now();
      }
      throw error;
    }
  }
}
