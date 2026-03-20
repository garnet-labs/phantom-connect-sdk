type GrantType = "authorization_code" | "refresh_token";

type TokenExchangeResult<G extends GrantType = GrantType> = {
  idType: string;
  accessToken: string;
  expiresInMs: number;
  refreshToken: G extends "refresh_token" ? string : string | undefined;
};

/**
 * Exchanges an authorization code for tokens via the Auth2 server.
 */
export async function exchangeAuthCode(options: {
  authApiBaseUrl: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<TokenExchangeResult<"authorization_code">> {
  return _postTokenRequest(
    options.authApiBaseUrl,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      code: options.code,
      code_verifier: options.codeVerifier,
    }),
  );
}

/**
 * Exchanges a refresh token for new tokens via the Auth2 server.
 * Requires the original authorization to have included the `offline_access` scope.
 */
export async function refreshToken(options: {
  authApiBaseUrl: string;
  clientId: string;
  redirectUri: string;
  refreshToken: string;
}): Promise<TokenExchangeResult<"refresh_token">> {
  const result = await _postTokenRequest(
    options.authApiBaseUrl,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      refresh_token: options.refreshToken,
    }),
  );
  if (!result.refreshToken) {
    throw new Error("Auth2 refresh token request did not return a refresh_token.");
  }
  return { ...result, refreshToken: result.refreshToken };
}

async function _postTokenRequest(authApiBaseUrl: string, body: URLSearchParams): Promise<TokenExchangeResult> {
  const tokenEndpoint = new URL("/oauth2/token", authApiBaseUrl).toString();

  const tokenResponse = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Auth2 token request failed (${tokenResponse.status} ${tokenResponse.statusText}): ${text}`);
  }

  const tokens = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
  };

  const accessToken = tokens.access_token;
  if (!accessToken) {
    throw new Error("Auth2 token request did not return an access_token.");
  }

  return {
    accessToken,
    idType: tokens.token_type ?? "Bearer",
    expiresInMs: tokens.expires_in != null ? tokens.expires_in * 1000 : 0,
    refreshToken: tokens.refresh_token,
  };
}
