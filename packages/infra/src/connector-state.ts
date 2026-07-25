export type ConnectorLifecycleState =
  | "unconfigured"
  | "disabled"
  | "configured"
  | "connected"
  | "degraded";

export type ConnectorMode = "mock" | "read_only" | "real";
export type EvidenceClass = "mock" | "local" | "live";

export interface ConnectorState {
  connectorKey: string;
  state: ConnectorLifecycleState;
  mode: ConnectorMode;
  evidenceClass: EvidenceClass;
  configured: boolean;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastConnectedAt: string | null;
  safeErrorCode: string | null;
  targetLabel: string;
  capabilities: string[];
  warnings: string[];
}

export function evaluateConnectorState(input: {
  connectorKey: string;
  targetLabel: string;
  hasCredentials: boolean;
  isEnabled: boolean;
  lastHandshakeSuccess?: boolean;
  lastHandshakeAt?: string;
  safeErrorCode?: string;
  mode?: ConnectorMode;
  evidenceClass?: EvidenceClass;
}): ConnectorState {
  const {
    connectorKey, targetLabel, hasCredentials, isEnabled,
    lastHandshakeSuccess, lastHandshakeAt, safeErrorCode,
    mode = "read_only", evidenceClass = "local",
  } = input;

  const warnings: string[] = [];
  let state: ConnectorLifecycleState = "unconfigured";

  if (!hasCredentials) {
    state = "unconfigured";
    warnings.push("필수 설정 또는 자격 증명이 부재합니다.");
  } else if (!isEnabled) {
    state = "disabled";
    warnings.push("오퍼레이터에 의해 비활성화되었습니다.");
  } else if (lastHandshakeSuccess === true) {
    state = "connected";
  } else if (lastHandshakeSuccess === false) {
    state = "degraded";
    warnings.push("최근 핸드셰이크 연결 시도가 실패했습니다.");
  } else {
    state = "configured";
  }

  return {
    connectorKey,
    targetLabel,
    state,
    mode,
    evidenceClass,
    configured: hasCredentials,
    enabled: isEnabled,
    lastCheckedAt: lastHandshakeAt || null,
    lastConnectedAt: lastHandshakeSuccess ? (lastHandshakeAt || null) : null,
    safeErrorCode: safeErrorCode || null,
    capabilities: ["read_telemetry"],
    warnings,
  };
}
