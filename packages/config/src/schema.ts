/**
 * @sangfor/config - Unified Environment Schema
 * Codex AC-005: ALL required secrets MUST be mandatory (not optional)
 * Codex HPF-005: Secret masking logger integration point
 */

import { z } from 'zod';
import { PORT_REGISTRY, getEnvDefaults } from './ports.js';

/** 시크릿 마스킹 유틸리티 (로거에서 사용) */
export const SECRET_KEYS = [
  'SECRET', 'KEY', 'TOKEN', 'PASSWORD', 'PASSWD', 'PWD',
  'PRIVATE', 'CREDENTIAL', 'AUTH', 'SIGNATURE',
] as const;

export function maskSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const upperKey = key.toUpperCase();
    const isSecret = SECRET_KEYS.some(k => upperKey.includes(k));
    masked[key] = isSecret ? '***MASKED***' : value;
  }
  return masked;
}

/** 필수 시크릿 스키마 - Codex AC-005: .optional() 제거, 런타임 검증 강제 */
export const RequiredSecretsSchema = z.object({
  // Core
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),
  NEXTAUTH_SECRET: z.string().min(32, 'NEXTAUTH_SECRET must be at least 32 chars'),
  NEXTAUTH_URL: z.string().url('NEXTAUTH_URL must be a valid URL'),

  // Microsoft Graph (Mail Intelligence + AIOS v1)
  MICROSOFT_TENANT_ID: z.string().min(1, 'MICROSOFT_TENANT_ID is required'),
  MICROSOFT_CLIENT_ID: z.string().min(1, 'MICROSOFT_CLIENT_ID is required'),
  MICROSOFT_CLIENT_SECRET: z.string().min(1, 'MICROSOFT_CLIENT_SECRET is required'),

  // GitHub
  GITHUB_TOKEN: z.string().min(1, 'GITHUB_TOKEN is required'),

  // Slack
  SLACK_BOT_TOKEN: z.string().min(1, 'SLACK_BOT_TOKEN is required'),
  SLACK_WEBHOOK_URL: z.string().url('SLACK_WEBHOOK_URL must be a valid URL').optional(),

  // LM Studio
  LM_STUDIO_URL: z.string().url().default('http://localhost:1234'),
});

/** 선택적/기능별 시크릿 - 명시적 opt-in */
export const OptionalSecretsSchema = z.object({
  // AIOS v1
  AIOS_V1_URL: z.string().url().default('http://localhost:3101'),
  AIOS_V1_API_KEY: z.string().optional(),

  // F-aios-v3
  F_AIOS_V3_URL: z.string().url().default('http://localhost:3201'),
  F_AIOS_V3_API_KEY: z.string().optional(),

  // Sangfor (실장비 연동 시에만 필요)
  SANGFOR_ALLOW_REAL_EXECUTION: z.coerce.boolean().default(false),
  SANGFOR_ALLOW_PRODUCTION_EXECUTION: z.coerce.boolean().default(false),

  // whelp99 MCP
  WHELP99_MCP_PATH: z.string().default('../whelp99-code-sangfor-engineer-mcp'),

  // GitHub Owner
  GITHUB_OWNER: z.string().default('whelp99-code'),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

/** 공통 설정 스키마 */
export const CommonConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(PORT_REGISTRY.PORTAL),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/** 전체 통합 스키마 */
export const UnifiedEnvSchema = CommonConfigSchema
  .merge(RequiredSecretsSchema)
  .merge(OptionalSecretsSchema);

/** 검증된 설정 타입 */
export type UnifiedConfig = z.infer<typeof UnifiedEnvSchema>;

/** 런타임 설정 파싱 및 검증 (빌드/스타트업 시 호출) */
let cachedConfig: UnifiedConfig | null = null;

export function getConfig(overrides?: Partial<UnifiedConfig>): UnifiedConfig {
  if (cachedConfig && !overrides) return cachedConfig;

  const env = {
    ...getEnvDefaults(),
    ...process.env,
    ...overrides,
  };

  const result = UnifiedEnvSchema.safeParse(env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const msg = Object.entries(errors)
      .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(', ')}`)
      .join('\n');
    throw new Error(`[Config Validation Failed]\n${msg}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

/** 검증 없이 설정 읽기 (테스트/개발용) */
export function getConfigUnsafe(): UnifiedConfig {
  return getConfig();
}

/** 설정 리셋 (테스트용) */
export function resetConfig(): void {
  cachedConfig = null;
}

/** 마스킹된 설정 출력 (로깅용) */
export function getMaskedConfig(): Record<string, unknown> {
  const config = getConfig();
  return maskSecrets(config as Record<string, unknown>);
}