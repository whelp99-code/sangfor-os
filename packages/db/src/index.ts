import { PrismaClient } from '@prisma/client'
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
export const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
export default prisma
export { Prisma } from '@prisma/client'
export {
  RLS_TENANT_SETTING,
  RLS_COMPANY_SETTING,
  RLS_PROJECT_SETTING,
  RLS_BASELINE_POLICIES,
  RLS_PILOT_TABLES,
  RLS_PILOT_POLICIES,
  buildRlsPolicyStatements,
  buildAllRlsPolicyStatements,
} from './rls'
export type { RlsContext, RlsTablePolicy, RlsExecutor, RlsPilotPolicy } from './rls'
export { withRlsTransaction, RlsScopeError } from './scoped-transaction'
export type { ScopedTransactionContext, ScopedTransactionCallback } from './scoped-transaction'
export {
  ARTIFACT_CONTENT_CONTRACT,
  ARTIFACT_CONTENT_HASH_VERSION,
  CanonicalContentError,
  canonicalizeRfc8785,
  parseCanonicalArtifactContent,
} from './canonical-content-hash'
export type { CanonicalContentErrorCode, ParsedCanonicalArtifactContent } from './canonical-content-hash'
export {
  AUTOPILOT_APPROVAL_DECISION_TYPE,
  AUTOPILOT_POLICY_DOMAINS,
  seedAutopilotPolicies,
} from './autonomy-policy-seed'
