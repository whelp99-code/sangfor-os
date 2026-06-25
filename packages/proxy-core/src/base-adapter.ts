/**
 * @sangfor/proxy-core - Base Proxy Adapter
 * Codex RC-001: Lazy proxy initialization - Portal starts even if upstreams are down
 * Circuit breaker, retry, timeout handling
 */

import { IUpstreamProxy, UpstreamConfig, ProxyRequest, ProxyResponse, HealthCheckResult, HealthStatus, CircuitBreakerState, HealthStatus as HealthStatusType } from './types';

export abstract class BaseProxyAdapter implements IUpstreamProxy {
  readonly config: UpstreamConfig;
  readonly circuitBreaker: CircuitBreakerState = {
    failures: 0,
    lastFailure: 0,
    state: 'closed',
    nextAttempt: 0,
  };

  private initialized = false;
  private controller: AbortController | null = null;

  constructor(config: UpstreamConfig) {
    this.config = config;
  }

  /** 지연 초기화 - 첫 요청 시 또는 명시적 호출 시 초기화 */
  protected async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    // 자식 클래스에서 오버라이드하여 실제 초기화 수행
    await this.onInitialize();
    this.initialized = true;
  }

  /** 자식 클래스에서 구현: 실제 초기화 로직 */
  protected abstract onInitialize(): Promise<void>;

  /** 헬스 체크 (liveness) - 가벼운 체크 */
  async checkHealth(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await this.ensureInitialized();
      const response = await fetch(`${this.config.baseUrl}${this.config.healthPath}`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
        headers: this.getAuthHeaders(),
      });

      const latencyMs = Date.now() - start;
      const status: HealthStatus = response.ok ? 'healthy' : 'degraded';
      
      this.recordSuccess();
      return { status, latencyMs, lastChecked: Date.now() };
    } catch (error) {
      this.recordFailure();
      return {
        status: 'unreachable',
        latencyMs: Date.now() - start,
        lastChecked: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /** 준비 상태 체크 (readiness) - 실제 트래픽 처리 가능 여부 */
  async checkReadiness(): Promise<HealthCheckResult> {
    const health = await this.checkHealth();
    // Readiness는 circuit breaker 상태도 고려
    if (this.circuitBreaker.state === 'open') {
      return { ...health, status: 'unreachable', details: { circuitBreaker: 'open' } };
    }
    return health;
  }

  /** 프록시 요청 실행 with retry & circuit breaker */
  async request<T>(req: ProxyRequest): Promise<ProxyResponse<T>> {
    if (!this.isAvailable()) {
      throw new Error(`Upstream ${this.config.name} unavailable: circuit breaker open`);
    }

    await this.ensureInitialized();

    let lastError: Error | null = null;
    const start = Date.now();

    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      try {
        const response = await this.executeRequest<T>(req);
        this.recordSuccess();
        return {
          ...response,
          latencyMs: Date.now() - start,
          upstream: this.config.name,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.recordFailure();
        
        if (attempt < this.config.retryCount) {
          await this.sleep(this.calculateBackoff(attempt));
        }
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  /** 실제 HTTP 요청 실행 (자식 클래스에서 오버라이드 가능) */
  protected async executeRequest<T>(req: ProxyRequest): Promise<Omit<ProxyResponse<T>, 'latencyMs' | 'upstream'>> {
    const url = new URL(req.path, this.config.baseUrl);
    if (req.query) {
      Object.entries(req.query).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const response = await fetch(url.toString(), {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
        ...req.headers,
      },
      body: req.body ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const data = await response.json().catch(() => null) as T | null;
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
    }

    if (data === null) {
      throw new Error('Empty response body');
    }

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      data,
    };
  }

  /** 인증 헤더 생성 */
  protected getAuthHeaders(): Record<string, string> {
    if (!this.config.auth || this.config.auth.type === 'none') return {};
    
    // 실제 토큰은 토큰 매니저에서 가져와야 함 - 여기서는 스텁
    const token = process.env[`${this.config.name.toUpperCase().replace('-', '_')}_TOKEN`];
    if (!token) return {};
    
    return {
      [this.config.auth.tokenHeader ?? 'Authorization']: 
        this.config.auth.type === 'bearer' ? `Bearer ${token}` : token,
    };
  }

  /** 서킷 브레이커 사용 가능 여부 */
  isAvailable(): boolean {
    if (this.circuitBreaker.state === 'closed') return true;
    
    if (this.circuitBreaker.state === 'open') {
      if (Date.now() > this.circuitBreaker.nextAttempt) {
        this.circuitBreaker.state = 'half-open';
        return true;
      }
      return false;
    }
    
    // half-open: 한 번만 허용
    return true;
  }

  /** 서킷 브레이커 리셋 */
  resetCircuitBreaker(): void {
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.state = 'closed';
    this.circuitBreaker.nextAttempt = 0;
  }

  /** 성공 기록 */
  protected recordSuccess(): void {
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.state = 'closed';
  }

  /** 실패 기록 */
  protected recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();
    
    if (this.circuitBreaker.failures >= this.config.circuitBreakerThreshold) {
      this.circuitBreaker.state = 'open';
      this.circuitBreaker.nextAttempt = Date.now() + this.config.circuitBreakerTimeoutMs;
    }
  }

  /** 백오프 계산 (지수 백오프 + 지터) */
  private calculateBackoff(attempt: number): number {
    const base = Math.min(1000 * Math.pow(2, attempt), 30000);
    const jitter = Math.random() * 1000;
    return base + jitter;
  }

  /** 슬립 유틸리티 */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** 정리 */
  async destroy(): Promise<void> {
    this.controller?.abort();
    this.initialized = false;
  }
}