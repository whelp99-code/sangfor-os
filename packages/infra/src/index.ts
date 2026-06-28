export { MetricsRegistry, metrics } from './metrics'
export { StructuredLogger, logger } from './logger'
export type { LogLevel } from './logger'
export { Tracer } from './tracing'
export type { Span } from './tracing'

export {
  getIntegrationTarget,
  probeIntegrationTarget,
  probeAllIntegrationTargets,
  listIntegrationTargets,
  resolveAiosWorkspaceRoot,
} from './integration'
export type {
  IntegrationTarget,
  IntegrationStatus,
  ProbeOptions,
} from './integration'

export { listMcpTools, callMcpTool } from './mcp-client'
export type { McpTool, McpCallResult, McpClientOptions } from './mcp-client'

export { engineerConsole } from './engineer-console'
export type { EngineerConsoleOptions } from './engineer-console'
