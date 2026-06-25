/**
 * @aios/config - Port Registry
 * 단일 소스 오브 트루스: 모든 서비스 포트 정의
 * Codex CB-001, AC-003, AC-004 대응
 */

export const PORT_REGISTRY = {
  // Portal (메인 엔트리포인트)
  PORTAL: 3100,

  // AIOS v2 (Turborepo)
  AIOS_V2_WEB: 3110,      // 3100 → 3110 변경 (Portal과 충돌 방지)
  AIOS_V2_API: 3200,      // Express API
  AIOS_V2_LIGHTRAG: 3300,
  AIOS_V2_JARVIS: 3310,   // 3500 → 3310 변경 (Sangfor와 충돌 방지)

  // AIOS v1 (메인 엔진)
  AIOS_V1: 3101,

  // F-aios-v3 (별도 프로세스, 3200 공유 불가 - Codex AC-003)
  F_AIOS_V3: 3201,        // 3200 → 3201 변경 (AIOSv2 API와 분리)

  // Sangfor MCP
  SANGFOR_MCP: 3500,
  SANGFOR_MOCK_CONSOLE: 3400,

  // Vibe Coding OS
  VIBE_CODING_OS: 4000,

  // Mail Intelligence
  MAIL_INTELLIGENCE: 3010,  // 10200 → 3010 표준 포트대 (Codex AC-004: Azure AD redirect_uri 갱신 필요)

  // whelp99 MCP HTTP bridge (stdio MCP wrapper)
  WHELP99_MCP_BRIDGE: 3600,
  WHELP99_OPERATOR_CONSOLE: 3502, // sangfor-mcp-workflow(3500)와 분리

  // Non-integration (Playground sibling — vibe 4000 충돌 방지)
  CFO_AI_API: 4100,

  // External
  LM_STUDIO: 1234,
} as const;

export type PortName = keyof typeof PORT_REGISTRY;

/** 포트 충돌 검증 */
export function validatePorts(): { valid: boolean; conflicts: string[] } {
  const used = new Map<number, PortName[]>();
  const conflicts: string[] = [];

  for (const [name, port] of Object.entries(PORT_REGISTRY) as [PortName, number][]) {
    const existing = used.get(port);
    if (existing) {
      conflicts.push(`Port ${port}: ${existing.join(', ')} vs ${name}`);
    } else {
      used.set(port, [name]);
    }
  }

  return { valid: conflicts.length === 0, conflicts };
}

/** 개발용 URL 생성 헬퍼 */
export function getUrl(service: PortName, path = ''): string {
  const port = PORT_REGISTRY[service];
  return `http://localhost:${port}${path}`;
}

/** 환경변수 기본값 생성 */
export function getEnvDefaults(): Record<string, string> {
  return {
    PORT: String(PORT_REGISTRY.PORTAL),
    AIOS_V1_URL: getUrl('AIOS_V1'),
    F_AIOS_V3_URL: getUrl('F_AIOS_V3'),
    SANGFOR_MCP_URL: getUrl('SANGFOR_MCP'),
    VIBE_CODING_OS_URL: getUrl('VIBE_CODING_OS'),
    MAIL_INTELLIGENCE_URL: getUrl('MAIL_INTELLIGENCE'),
    LM_STUDIO_URL: getUrl('LM_STUDIO'),
    WHELP99_MCP_PATH: '../whelp99-code-sangfor-engineer-mcp',
    WHELP99_MCP_HTTP_URL: getUrl('WHELP99_MCP_BRIDGE'),
  };
}