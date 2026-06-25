export { MetricsRegistry, metrics } from './metrics'
export { StructuredLogger, logger } from './logger'
export type { LogLevel } from './logger'
export { Tracer } from './tracing'
export type { Span } from './tracing'

export interface IntegrationTarget {
  id: string
  status: string
  upstream: string
  details?: string
  readinessNote?: string
}

export function getIntegrationTarget(name: string): IntegrationTarget {
  return { id: name, status: 'unknown', upstream: '', readinessNote: '' }
}

export function probeIntegrationTarget(target: IntegrationTarget, opts?: { workspaceRoot?: string }): Promise<IntegrationTarget> {
  return Promise.resolve({ ...target, status: 'unknown' })
}

export function resolveAiosWorkspaceRoot(): string {
  return process.cwd()
}
