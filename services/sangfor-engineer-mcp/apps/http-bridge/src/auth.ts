import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export type BridgeAuthContext = Readonly<{ principalId: 'engineer-http-bridge'; role: 'operator'; source: 'bridge_credential' }>;
function single(headers: IncomingHttpHeaders, name: string): string | undefined { const value = headers[name]; return typeof value === 'string' ? value.trim() || undefined : undefined; }
/** Dedicated bridge credential; bearer/API/user tokens are deliberately ignored. */
export function authenticateBridgeCredential(headers: IncomingHttpHeaders, env: NodeJS.ProcessEnv = process.env): BridgeAuthContext | undefined {
  const expected = env.SANGFOR_BRIDGE_CREDENTIAL?.trim(); const presented = single(headers, 'x-sangfor-bridge-credential');
  if (!expected || !presented) return undefined;
  const a = createHash('sha256').update(presented).digest(); const b = createHash('sha256').update(expected).digest();
  if (!timingSafeEqual(a, b)) return undefined;
  return { principalId: 'engineer-http-bridge', role: 'operator', source: 'bridge_credential' };
}
