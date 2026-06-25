/**
 * @aios/health - Health Monitoring System
 * Codex AC-001: Liveness vs Readiness probe separation
 * Portal starts without upstreams - async health probes
 */

export type HealthStatus = "healthy" | "degraded" | "unreachable" | "planned";

export interface HealthCheckResult {
  status: HealthStatus;
  latencyMs?: number;
  lastChecked: number;
  details?: Record<string, unknown>;
  error?: string;
}

export interface ServiceHealthConfig {
  name: string;
  baseUrl: string;
  livenessPath: string; // 가벼운 체크 (/health/liveness)
  readinessPath: string; // 실제 트래픽 처리 여부 (/health/readiness)
  timeoutMs: number;
  intervalMs: number; // 주기적 체크 간격
  critical: boolean; // 전체 시스템 헬스에 영향
}

/** 서비스 레지스트리 - Codex AC-001: 독립적 헬스 프로브 */
export class ServiceRegistry {
  private services = new Map<string, ServiceHealthConfig>();
  private results = new Map<string, HealthCheckResult>();
  private intervals = new Map<string, NodeJS.Timeout>();

  /** 서비스 등록 */
  register(config: ServiceHealthConfig): void {
    this.services.set(config.name, config);
    this.results.set(config.name, {
      status: "planned",
      lastChecked: 0,
    });
  }

  /** 서비스 등록 해제 */
  unregister(name: string): void {
    this.services.delete(name);
    this.results.delete(name);
    const interval = this.intervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(name);
    }
  }

  /** 단일 서비스 헬스 체크 (liveness) */
  async checkLiveness(name: string): Promise<HealthCheckResult> {
    const config = this.services.get(name);
    if (!config) {
      return {
        status: "unreachable",
        lastChecked: Date.now(),
        error: "Service not registered",
      };
    }

    const start = Date.now();
    try {
      const response = await fetch(`${config.baseUrl}${config.livenessPath}`, {
        method: "GET",
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      const latencyMs = Date.now() - start;
      const status: HealthStatus = response.ok ? "healthy" : "degraded";
      const result: HealthCheckResult = {
        status,
        latencyMs,
        lastChecked: Date.now(),
      };
      this.results.set(name, result);
      return result;
    } catch (error) {
      const result: HealthCheckResult = {
        status: "unreachable",
        latencyMs: Date.now() - start,
        lastChecked: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      };
      this.results.set(name, result);
      return result;
    }
  }

  /** 단일 서비스 준비도 체크 (readiness) */
  async checkReadiness(name: string): Promise<HealthCheckResult> {
    const liveness = await this.checkLiveness(name);
    if (liveness.status !== "healthy") return liveness;

    const config = this.services.get(name)!;
    const start = Date.now();
    try {
      const response = await fetch(`${config.baseUrl}${config.readinessPath}`, {
        method: "GET",
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      const latencyMs = Date.now() - start;
      const status: HealthStatus = response.ok ? "healthy" : "degraded";
      return { status, latencyMs, lastChecked: Date.now() };
    } catch (error) {
      return {
        status: "unreachable",
        latencyMs: Date.now() - start,
        lastChecked: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /** 전체 서비스 헬스 체크 (비동기, 병렬) */
  async checkAll(): Promise<Map<string, HealthCheckResult>> {
    const names = Array.from(this.services.keys());
    await Promise.all(names.map((name) => this.checkLiveness(name)));
    return new Map(this.results);
  }

  /** 주기적 헬스 체크 시작 */
  startPeriodicChecks(): void {
    for (const [name, config] of this.services) {
      if (this.intervals.has(name)) continue;

      const interval = setInterval(() => {
        this.checkLiveness(name).catch(console.error);
      }, config.intervalMs);

      this.intervals.set(name, interval);
      // 프로세스 종료 방지
      interval.unref?.();
    }
  }

  /** 주기적 헬스 체크 중지 */
  stopPeriodicChecks(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }

  /** 최신 결과 조회 */
  getResult(name: string): HealthCheckResult | undefined {
    return this.results.get(name);
  }

  /** 전체 결과 조회 */
  getAllResults(): Map<string, HealthCheckResult> {
    return new Map(this.results);
  }

  /** 전체 시스템 헬스 상태 계산 */
  getSystemHealth(): {
    status: HealthStatus;
    services: Map<string, HealthCheckResult>;
  } {
    const results = this.getAllResults();
    let status: HealthStatus = "healthy";

    for (const [name, result] of results) {
      const config = this.services.get(name);
      if (!config) continue;

      if (config.critical) {
        if (result.status === "unreachable") {
          status = "unreachable";
          break;
        } else if (result.status === "degraded" && status === "healthy") {
          status = "degraded";
        }
      }
    }

    return { status, services: results };
  }
}

/** 싱글톤 레지스트리 */
let registryInstance: ServiceRegistry | null = null;

export function getRegistry(): ServiceRegistry {
  if (!registryInstance) {
    registryInstance = new ServiceRegistry();
  }
  return registryInstance;
}

export function resetRegistry(): void {
  registryInstance?.stopPeriodicChecks();
  registryInstance = null;
}

/** SSE 스트림용 헬스 이벤트 */
export interface HealthEvent {
  type: "health-update";
  timestamp: number;
  service: string;
  result: HealthCheckResult;
}

/** 헬스 스트림 생성 (Server-Sent Events) */
export function createHealthStream(): ReadableStream<Uint8Array> {
  const registry = getRegistry();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const interval = setInterval(() => {
        if (closed) return;
        registry.checkAll().then((results) => {
          if (closed) return;
          try {
            for (const [name, result] of results) {
              const event: HealthEvent = {
                type: "health-update",
                timestamp: Date.now(),
                service: name,
                result,
              };
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            }
          } catch {
            // controller closed, ignore
          }
        });
      }, 10000);

      return () => {
        closed = true;
        clearInterval(interval);
      };
    },
  });
}
