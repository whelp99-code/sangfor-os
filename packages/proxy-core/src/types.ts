/**
 * @aios/proxy-core - Upstream Proxy Adapter Pattern
 * Codex RC-002: Single proxy class replaced with per-upstream adapters
 * Codex AC-002: Interface segregation for wildly different upstream contracts
 */

export type UpstreamName = 
  | 'aios-v1' 
  | 'f-aios-v3' 
  | 'sangfor' 
  | 'vibe-coding-os' 
  | 'mail-intelligence' 
  | 'whelp99-mcp'
  | 'github'
  | 'slack';

export type HealthStatus = 'healthy' | 'degraded' | 'unreachable' | 'planned';

export type ApprovalGateType = 
  | 'deploy'           // 배포/실행
  | 'external-share'   // 외부 공유/데이터 내보내기
  | 'data-mutation'    // CRUD 쓰기 작업
  | 'config-change'    // 설정 변경
  | 'device-control'   // 장비 제어 (Sangfor)
  | 'financial'        // 결제/청구
  | 'user-management'; // 사용자 관리

export type GateRequirement = ApprovalGateType | 'none';

export interface HealthCheckResult {
  status: HealthStatus;
  latencyMs?: number;
  lastChecked: number;
  details?: Record<string, unknown>;
  error?: string;
}

export interface ProxyRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}

export interface ProxyResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
  latencyMs: number;
  upstream: UpstreamName;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
  nextAttempt: number;
}

/** 업스트림별 공통 설정 */
export interface UpstreamConfig {
  name: UpstreamName;
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeoutMs: number;
  healthPath: string;
  auth?: {
    type: 'bearer' | 'api-key' | 'none';
    tokenHeader?: string;
  };
}

/** 공통 프록시 인터페이스 - 모든 어댑터가 구현 */
export interface IUpstreamProxy {
  readonly config: UpstreamConfig;
  readonly circuitBreaker: CircuitBreakerState;

  /** 헬스 체크 (liveness) */
  checkHealth(): Promise<HealthCheckResult>;

  /** 준비 상태 체크 (readiness) - 실제 트래픽 처리 가능 여부 */
  checkReadiness(): Promise<HealthCheckResult>;

  /** 프록시 요청 실행 */
  request<T>(req: ProxyRequest): Promise<ProxyResponse<T>>;

  /** 서킷 브레이커 상태 확인 */
  isAvailable(): boolean;

  /** 서킷 브레이커 강제 리셋 */
  resetCircuitBreaker(): void;
}

/** 승인 요청 컨텍스트 */
export interface ApprovalContext {
  gateType: GateRequirement;
  userId: string;
  product: UpstreamName;
  action: string;
  resource: string;
  payload: unknown;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, unknown>;
}

/** 게이트 결정 */
export interface GateDecision {
  approved: boolean;
  reason?: string;
  expiresAt?: number;
  conditions?: string[];
}

/** 승인 게이트 인터페이스 */
export interface IApprovalGate {
  evaluate(context: ApprovalContext): Promise<GateDecision>;
  getPendingApprovals(userId?: string): Promise<ApprovalContext[]>;
  approve(requestId: string, ApproverId: string): Promise<void>;
  reject(requestId: string, approverId: string, reason: string): Promise<void>;
}

/** 프록시 어댑터 팩토리 타입 */
export type ProxyAdapterFactory = (config: UpstreamConfig) => IUpstreamProxy;