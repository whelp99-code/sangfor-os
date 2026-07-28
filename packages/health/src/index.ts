/**
 * @sangfor/health - Public API (canonical registry owner, U006)
 */
export {
  FAKE_HEALTH_DOMAIN_PATTERN,
  HEALTH_REGISTRY,
  getHealthRegistryEntry,
  listHealthRegistryEntries,
  probeCanonicalHealth,
  redactHealthText,
  redactHealthUrl,
} from './registry';
export type {
  HealthCriticality,
  HealthRegistryEntry,
  ProbeCanonicalOptions,
  UnifiedHealthReport,
  UnifiedHealthStatus,
  UnifiedServiceHealth,
} from './registry';
