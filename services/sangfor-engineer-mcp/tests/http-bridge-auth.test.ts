import { describe, expect, it } from 'vitest';
import { authenticateBridgeCredential } from '../apps/http-bridge/src/auth.js';

describe('HTTP bridge credential', () => {
  it('rejects bearer/API credentials and accepts only the dedicated bridge credential', () => {
    const env = { SANGFOR_BRIDGE_CREDENTIAL: 'bridge-secret' } as NodeJS.ProcessEnv;
    expect(authenticateBridgeCredential({ authorization: 'Bearer bridge-secret' }, env)).toBeUndefined();
    expect(authenticateBridgeCredential({ 'x-sangfor-bridge-credential': 'wrong' }, env)).toBeUndefined();
    expect(authenticateBridgeCredential({ 'x-sangfor-bridge-credential': 'bridge-secret' }, env)).toMatchObject({ source: 'bridge_credential' });
  });
});
