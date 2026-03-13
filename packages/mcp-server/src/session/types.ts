/**
 * SSO callback parameters received from the connect.phantom.app
 */
export interface OAuthCallbackParams {
  session_id: string;
  wallet_id: string;
  organization_id: string;
  auth_user_id: string;
}

/**
 * OAuth tokens (not used in SSO flow, kept for compatibility)
 */
export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Dynamic Client Registration (DCR) client configuration
 */
export interface DCRClientConfig {
  client_id: string;
  client_secret: string;
  client_id_issued_at: number;
}

/**
 * Complete session data stored on disk
 *
 * Note: SSO flow uses stamper keys for API authentication, not OAuth tokens
 */
export interface SessionData {
  walletId: string;
  organizationId: string;
  authUserId: string;
  /** App/client ID used during authentication (for quote API key headers) */
  appId?: string;
  /** Auth flow used to create this session */
  authFlow?: "sso" | "device-code";
  stamperKeys: {
    publicKey: string;
    secretKey: string;
  };
  /** OAuth tokens — only present for device-code flow sessions */
  oauthTokens?: {
    accessToken: string;
    refreshToken: string;
    idToken?: string;
    /** Unix timestamp when the access token expires */
    expiresAt: number;
  };
  createdAt: number;
  updatedAt: number;
}
