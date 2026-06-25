/**
 * @sangfor/auth - JWT Token Manager (jose v5 compatible)
 * Codex HPF-002: Per-product token manager with scope isolation
 */

import { SignJWT, jwtVerify } from 'jose';
import { getConfig } from '@sangfor/config';

/** 제품별 OAuth 스코프 레지스트리 */
export const PRODUCT_SCOPES = {
  'aios-v1': [
    'https://graph.microsoft.com/Mail.Read',
    'https://graph.microsoft.com/Mail.ReadWrite',
    'https://graph.microsoft.com/Contacts.Read',
    'offline_access',
  ] as const,

  'mail-intelligence': [
    'https://graph.microsoft.com/Mail.Read',
    'https://graph.microsoft.com/Mail.Send',
    'offline_access',
  ] as const,

  portal: [
    'https://graph.microsoft.com/User.Read',
    'offline_access',
  ] as const,

  sangfor: [] as const,

  'vibe-coding-os': [
    'repo',
    'read:org',
  ] as const,
} as const;

export type ProductName = keyof typeof PRODUCT_SCOPES;

/** 토큰 페이로드 타입 */
export interface TokenPayload {
  sub: string;
  product: ProductName;
  scopes: string[];
  iat: number;
  exp: number;
  jti: string;
}

/** 저장된 토큰 정보 */
export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes: string[];
  product: ProductName;
}

/** 토큰 매니저 설정 */
export interface TokenManagerConfig {
  tokenTtlMs: number;
  refreshTtlMs: number;
}

/** 토큰 매니저 클래스 - 제품별 격리 저장소 */
export class TokenManager {
  private store = new Map<ProductName, StoredToken>();
  private config: TokenManagerConfig;
  private signingKey: CryptoKey | null = null;

  constructor(config?: Partial<TokenManagerConfig>) {
    this.config = {
      tokenTtlMs: 15 * 60 * 1000,
      refreshTtlMs: 30 * 24 * 60 * 60 * 1000,
      ...config,
    };
  }

  private async getSigningKey(): Promise<CryptoKey> {
    if (this.signingKey) return this.signingKey;

    const cfg = getConfig();
    // Use NEXTAUTH_SECRET as base for key derivation
    const encoder = new TextEncoder();
    const keyData = await crypto.subtle.importKey(
      'raw',
      encoder.encode(cfg.NEXTAUTH_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    this.signingKey = keyData;
    return this.signingKey;
  }

  /** 제품별 액세스 토큰 발급 (JWT) */
  async issueAccessToken(userId: string, product: ProductName, customScopes?: string[]): Promise<string> {
    const scopes = customScopes ?? PRODUCT_SCOPES[product];
    const now = Math.floor(Date.now() / 1000);
    const exp = now + Math.floor(this.config.tokenTtlMs / 1000);
    const key = await this.getSigningKey();

    const token = await new SignJWT({
      sub: userId,
      product,
      scopes,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .setJti(crypto.randomUUID())
      .sign(key);

    return token;
  }

  /** 토큰 검증 및 페이로드 반환 */
  async verifyToken(token: string): Promise<TokenPayload | null> {
    try {
      const key = await this.getSigningKey();
      const { payload } = await jwtVerify(token, key);
      return payload as unknown as TokenPayload;
    } catch {
      return null;
    }
  }

  /** Microsoft Graph 토큰 저장 (제품별 격리) - 평문 저장 (암호화는 추후) */
  async storeGraphToken(
    product: ProductName,
    accessToken: string,
    refreshToken: string | undefined,
    expiresIn: number,
    scopes: string[]
  ): Promise<void> {
    const stored: StoredToken = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      scopes,
      product,
    };
    this.store.set(product, stored);
  }

  /** 제품별 Microsoft Graph 액세스 토큰 조회 */
  async getGraphToken(product: ProductName): Promise<string | null> {
    const stored = this.store.get(product);
    if (!stored) return null;

    if (Date.now() > stored.expiresAt - 5 * 60 * 1000) {
      if (stored.refreshToken) {
        const refreshed = await this.refreshGraphToken(product, stored.refreshToken);
        if (refreshed) return refreshed;
      }
      return null;
    }

    return stored.accessToken;
  }

  /** 리프레시 토큰으로 액세스 토큰 갱신 (스텁) */
  private async refreshGraphToken(product: ProductName, refreshToken: string): Promise<string | null> {
    console.warn(`[TokenManager] Refresh token flow not yet implemented for ${product}`);
    return null;
  }

  /** 토큰 취소 */
  revokeToken(product: ProductName): void {
    this.store.delete(product);
  }

  revokeAllTokens(): void {
    this.store.clear();
  }

  getStoredProducts(): ProductName[] {
    return Array.from(this.store.keys());
  }
}

/** 싱글톤 인스턴스 */
let tokenManagerInstance: TokenManager | null = null;

export function getTokenManager(): TokenManager {
  if (!tokenManagerInstance) {
    tokenManagerInstance = new TokenManager();
  }
  return tokenManagerInstance;
}

export function resetTokenManager(): void {
  tokenManagerInstance = null;
}