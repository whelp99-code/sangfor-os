/**
 * Microsoft Graph API OAuth 2.0 인증
 * 
 * Azure AD 앱 등록 후 획득한 Client ID/Secret으로
 * OAuth 2.0 인증 플로우를 구현한다.
 */

// OAuth 설정
export interface GraphOAuthConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
  scopes: string[];
}

// 토큰 응답
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope: string;
  expiresAt: Date;
}

interface RawTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

// 토큰 저장소
export interface TokenStore {
  get(userId: string): Promise<TokenResponse | null>;
  set(userId: string, token: TokenResponse): Promise<void>;
  delete(userId: string): Promise<void>;
}

/**
 * Graph API OAuth 클라이언트
 */
export class GraphOAuthClient {
  private config: GraphOAuthConfig;
  private tokenStore: TokenStore;

  constructor(config: GraphOAuthConfig, tokenStore: TokenStore) {
    this.config = config;
    this.tokenStore = tokenStore;
  }

  /**
   * 인증 URL 생성 (사용자를 Azure AD 로그인 페이지로 리다이렉트)
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state,
      response_mode: 'query',
    });

    return `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /**
   * 인증 코드로 토큰 교환
   */
  async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    const url = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
    
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code',
      scope: this.config.scopes.join(' '),
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data: RawTokenResponse = await response.json();
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
      scope: data.scope,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  /**
   * 리프레시 토큰으로 액세스 토큰 갱신
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const url = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
    
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: this.config.scopes.join(' '),
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const data: RawTokenResponse = await response.json();
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
      scope: data.scope,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  /**
   * 유효한 액세스 토큰 조회 (만료 시 자동 갱신)
   */
  async getValidToken(userId: string): Promise<string> {
    let token = await this.tokenStore.get(userId);

    if (!token) {
      throw new Error(`No token found for user ${userId}. Please authorize first.`);
    }

    // 토큰 만료 확인 (5분 여유)
    if (token.expiresAt.getTime() - 5 * 60 * 1000 < Date.now()) {
      console.log('[GraphOAuth] Token expired, refreshing...');
      token = await this.refreshAccessToken(token.refreshToken);
      await this.tokenStore.set(userId, token);
    }

    return token.accessToken;
  }

  /**
   * Graph API 호출 (인증 포함)
   */
  async callGraphAPI(userId: string, endpoint: string, options: RequestInit = {}): Promise<any> {
    const accessToken = await this.getValidToken(userId);
    
    const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Graph API call failed: ${response.status} ${error}`);
    }

    return response.json();
  }

  /**
   * 사용자 메일 조회
   */
  async getMessages(userId: string, top: number = 10): Promise<any[]> {
    const data = await this.callGraphAPI(userId, `/me/messages?$top=${top}&$orderby=receivedDateTime desc`);
    return data.value;
  }

  /**
   * 메일 웹훅 구독 생성
   */
  async createMailSubscription(userId: string, notificationUrl: string): Promise<any> {
    const expirationDateTime = new Date();
    expirationDateTime.setDate(expirationDateTime.getDate() + 3); // 3일 후

    return this.callGraphAPI(userId, '/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        changeType: 'created',
        notificationUrl,
        resource: '/me/messages',
        expirationDateTime: expirationDateTime.toISOString(),
        clientState: process.env.WEBHOOK_CLIENT_STATE || 'aios-webhook',
      }),
    });
  }

  /**
   * 웹훅 구독 갱신
   */
  async renewSubscription(userId: string, subscriptionId: string): Promise<any> {
    const expirationDateTime = new Date();
    expirationDateTime.setDate(expirationDateTime.getDate() + 3); // 3일 후

    return this.callGraphAPI(userId, `/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expirationDateTime: expirationDateTime.toISOString(),
      }),
    });
  }
}

/**
 * 메모리 기반 토큰 저장소 (개발용)
 */
export class MemoryTokenStore implements TokenStore {
  private store: Map<string, TokenResponse> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [userId, token] of this.store) {
        if (now > token.expiresAt.getTime()) {
          this.store.delete(userId);
        }
      }
    }, 5 * 60 * 1000);
  }

  async get(userId: string): Promise<TokenResponse | null> {
    return this.store.get(userId) || null;
  }

  async set(userId: string, token: TokenResponse): Promise<void> {
    this.store.set(userId, token);
  }

  async delete(userId: string): Promise<void> {
    this.store.delete(userId);
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}
