import { exchangeAuthCode, refreshToken } from "../tokenExchange";

function mockFetch(): jest.Mock {
  return globalThis.fetch as jest.Mock;
}

describe("exchangeAuthCode()", () => {
  const baseOptions = {
    authApiBaseUrl: "https://auth.example.com",
    clientId: "client-id",
    redirectUri: "https://app.example.com/cb",
    code: "auth-code",
    codeVerifier: "code-verifier",
  };

  it("POSTs to /oauth2/token with grant_type=authorization_code", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "access-tok", token_type: "Bearer", expires_in: 3600 }),
    });

    await exchangeAuthCode(baseOptions);

    const [url, init] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.example.com/oauth2/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("redirect_uri")).toBe("https://app.example.com/cb");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("code-verifier");
  });

  it("returns accessToken, idType, and expiresInMs on success", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "access-tok", token_type: "Bearer", expires_in: 7200 }),
    });

    const result = await exchangeAuthCode(baseOptions);

    expect(result.accessToken).toBe("access-tok");
    expect(result.idType).toBe("Bearer");
    expect(result.expiresInMs).toBe(7200 * 1000);
  });

  it("includes refresh_token when present in the response", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "access-tok",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rt-abc",
      }),
    });

    expect((await exchangeAuthCode(baseOptions)).refreshToken).toBe("rt-abc");
  });

  it("returns undefined refreshToken when refresh_token is absent", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "access-tok", token_type: "Bearer", expires_in: 0 }),
    });

    expect((await exchangeAuthCode(baseOptions)).refreshToken).toBeUndefined();
  });

  it("uses token_type from response in idType", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "access-tok", token_type: "JWT", expires_in: 0 }),
    });

    expect((await exchangeAuthCode(baseOptions)).idType).toBe("JWT");
  });

  it("defaults idType to Bearer when token_type is absent", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "access-tok" }),
    });

    expect((await exchangeAuthCode(baseOptions)).idType).toBe("Bearer");
  });

  it("sets expiresInMs to 0 when expires_in is absent", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "access-tok" }),
    });

    expect((await exchangeAuthCode(baseOptions)).expiresInMs).toBe(0);
  });

  it("throws when the response is not ok", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "invalid_grant",
    });

    await expect(exchangeAuthCode(baseOptions)).rejects.toThrow("Auth2 token request failed (400 Bad Request)");
  });

  it("throws when access_token is absent", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token_type: "Bearer" }),
    });

    await expect(exchangeAuthCode(baseOptions)).rejects.toThrow("did not return an access_token");
  });
});

describe("refreshToken()", () => {
  const baseOptions = {
    authApiBaseUrl: "https://auth.example.com",
    clientId: "client-id",
    redirectUri: "https://app.example.com/cb",
    refreshToken: "rt-existing",
  };

  it("POSTs to /oauth2/token with grant_type=refresh_token", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "access-tok",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rt-new",
      }),
    });

    await refreshToken(baseOptions);

    const body = new URLSearchParams((mockFetch().mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-existing");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("redirect_uri")).toBe("https://app.example.com/cb");
  });

  it("returns accessToken, idType, expiresInMs, and refreshToken on success", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "access-tok",
        token_type: "Bearer",
        expires_in: 1800,
        refresh_token: "rt-new",
      }),
    });

    const result = await refreshToken(baseOptions);

    expect(result.accessToken).toBe("access-tok");
    expect(result.idType).toBe("Bearer");
    expect(result.expiresInMs).toBe(1800 * 1000);
    expect(result.refreshToken).toBe("rt-new");
  });

  it("throws when the response does not include a refresh_token", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "access-tok", token_type: "Bearer", expires_in: 0 }),
    });

    await expect(refreshToken(baseOptions)).rejects.toThrow("did not return a refresh_token");
  });

  it("throws when access_token is absent", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token_type: "Bearer", expires_in: 0, refresh_token: "rt-new" }),
    });

    await expect(refreshToken(baseOptions)).rejects.toThrow("did not return an access_token");
  });

  it("throws when the response is not ok", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "invalid_grant",
    });

    await expect(refreshToken(baseOptions)).rejects.toThrow("Auth2 token request failed (401 Unauthorized)");
  });
});
