const mockPrepareAuth2Flow = jest.fn().mockResolvedValue({
  url: "https://auth.example.com/login/start?client_id=rn-client-id&state=rn-session-1",
  codeVerifier: "rn-code-verifier",
  keyPair: { privateKey: {}, publicKey: {} },
});

const mockCompleteAuth2Exchange = jest.fn().mockResolvedValue({
  walletId: "wallet-rn-456",
  organizationId: "org-rn-123",
  provider: "google",
  accountDerivationIndex: 0,
  expiresInMs: 7_200_000,
  authUserId: "rn-user-1",
  bearerToken: "Bearer rn-id-token",
});

jest.mock("@phantom/auth2", () => {
  const actual = jest.requireActual<Record<string, unknown>>("@phantom/auth2");
  return {
    prepareAuth2Flow: mockPrepareAuth2Flow,
    completeAuth2Exchange: mockCompleteAuth2Exchange,
    validateAuth2Callback: actual.validateAuth2Callback,
    Auth2KmsRpcClient: jest.fn().mockImplementation(() => ({})),
  };
});

import type { AuthResult } from "@phantom/embedded-provider-core";
import * as WebBrowser from "expo-web-browser";
import { ExpoAuth2AuthProvider } from "./ExpoAuth2AuthProvider";

const AUTH2_OPTIONS = {
  clientId: "rn-client-id",
  redirectUri: "myapp://callback",
  connectLoginUrl: "https://auth.example.com/login/start",
  authApiBaseUrl: "https://auth.example.com",
};

const KMS_OPTIONS = { apiBaseUrl: "https://kms.example.com", appId: "rn-app" };

function makeStamper() {
  return {
    stamp: jest.fn(),
    getKeyInfo: jest.fn().mockReturnValue({ keyId: "k1", publicKey: "pub", createdAt: Date.now() }),
    getCryptoKeyPair: jest.fn().mockReturnValue({ privateKey: {}, publicKey: {} }),
    init: jest.fn(),
    getTokens: jest.fn(),
    setTokens: jest.fn(),
    rotateKeyPair: jest.fn(),
    commitRotation: jest.fn(),
    rollbackRotation: jest.fn(),
    resetKeyPair: jest.fn(),
    clear: jest.fn(),
    algorithm: "ECDSA_P256",
    type: "OIDC" as "PKI" | "OIDC",
  };
}

type StamperArg = ConstructorParameters<typeof ExpoAuth2AuthProvider>[0];

function makeProvider(stamper = makeStamper()) {
  return new ExpoAuth2AuthProvider(stamper as unknown as StamperArg, AUTH2_OPTIONS, KMS_OPTIONS);
}

function successResult(url: string) {
  return { type: "success" as const, url };
}

function callbackUrl(params: Record<string, string> = {}) {
  const url = new URL("myapp://callback");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

const CONNECT_OPTIONS = {
  publicKey: "7EcDshMsTHCs2f2HU2a3n36x9JkEVVenF9oQQGy5U3s",
  appId: "rn-app",
  sessionId: "rn-session-1",
  provider: "google" as const,
  redirectUrl: "myapp://callback",
};

describe("ExpoAuth2AuthProvider.authenticate()", () => {
  beforeEach(() => {
    (WebBrowser.warmUpAsync as jest.Mock).mockResolvedValue(undefined);
    (WebBrowser.coolDownAsync as jest.Mock).mockResolvedValue(undefined);
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue(
      successResult(callbackUrl({ code: "auth-code", state: "rn-session-1" })),
    );
    mockPrepareAuth2Flow.mockResolvedValue({
      url: "https://auth.example.com/login/start?client_id=rn-client-id&state=rn-session-1",
      codeVerifier: "rn-code-verifier",
      keyPair: { privateKey: {}, publicKey: {} },
    });
    mockCompleteAuth2Exchange.mockResolvedValue({
      walletId: "wallet-rn-456",
      organizationId: "org-rn-123",
      provider: "google",
      accountDerivationIndex: 0,
      expiresInMs: 7_200_000,
      authUserId: "rn-user-1",
      bearerToken: "Bearer rn-id-token",
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("calls prepareAuth2Flow with the stamper and auth options", async () => {
    await makeProvider().authenticate(CONNECT_OPTIONS);

    expect(mockPrepareAuth2Flow).toHaveBeenCalledWith(
      expect.objectContaining({
        auth2Options: AUTH2_OPTIONS,
        sessionId: CONNECT_OPTIONS.sessionId,
        provider: CONNECT_OPTIONS.provider,
      }),
    );
  });

  it("propagates errors from prepareAuth2Flow (e.g. missing key pair)", async () => {
    mockPrepareAuth2Flow.mockRejectedValueOnce(new Error("Stamper key pair not found."));

    await expect(makeProvider().authenticate(CONNECT_OPTIONS)).rejects.toThrow("Stamper key pair not found.");
  });

  it("passes the correct provider to prepareAuth2Flow", async () => {
    await makeProvider().authenticate({ ...CONNECT_OPTIONS, provider: "apple" });

    expect(mockPrepareAuth2Flow).toHaveBeenCalledWith(expect.objectContaining({ provider: "apple" }));
  });

  it("passes the URL from prepareAuth2Flow to openAuthSessionAsync", async () => {
    const mockUrl = "https://auth.example.com/login/start?foo=bar";
    mockPrepareAuth2Flow.mockResolvedValueOnce({ url: mockUrl, codeVerifier: "v", keyPair: {} });
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce(
      successResult(callbackUrl({ code: "c", state: "rn-session-1" })),
    );

    await makeProvider().authenticate(CONNECT_OPTIONS);

    const [authUrl] = (WebBrowser.openAuthSessionAsync as jest.Mock).mock.calls[0] as [string, string];
    expect(authUrl).toBe(mockUrl);
  });

  it("passes the redirectUri as the second argument to openAuthSessionAsync", async () => {
    await makeProvider().authenticate(CONNECT_OPTIONS);

    const [, redirectArg] = (WebBrowser.openAuthSessionAsync as jest.Mock).mock.calls[0] as [string, string];
    expect(redirectArg).toBe("myapp://callback");
  });

  it("calls warmUpAsync before and coolDownAsync after the browser session", async () => {
    await makeProvider().authenticate(CONNECT_OPTIONS);

    expect(WebBrowser.warmUpAsync).toHaveBeenCalled();
    expect(WebBrowser.coolDownAsync).toHaveBeenCalled();
  });

  it("always calls coolDownAsync even when openAuthSessionAsync throws", async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockRejectedValueOnce(new Error("browser crash"));
    await expect(makeProvider().authenticate(CONNECT_OPTIONS)).rejects.toThrow("browser crash");

    expect(WebBrowser.coolDownAsync).toHaveBeenCalled();
  });

  it("throws when the user cancels authentication", async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce({ type: "cancel" });

    await expect(makeProvider().authenticate(CONNECT_OPTIONS)).rejects.toThrow("Authentication failed");
  });

  it("throws when the browser result type is not 'success'", async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce({ type: "dismiss" });

    await expect(makeProvider().authenticate(CONNECT_OPTIONS)).rejects.toThrow("Authentication failed");
  });

  it("throws when the result URL is absent on a success result", async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce({ type: "success", url: "" });

    await expect(makeProvider().authenticate(CONNECT_OPTIONS)).rejects.toThrow("Authentication failed");
  });

  it("throws on state mismatch (CSRF protection)", async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce(
      successResult(callbackUrl({ code: "c", state: "WRONG" })),
    );

    await expect(makeProvider().authenticate(CONNECT_OPTIONS)).rejects.toThrow("CSRF");
  });

  it("throws when error param is present in the callback URL", async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce(
      successResult(callbackUrl({ error: "access_denied", error_description: "User denied", state: "rn-session-1" })),
    );

    await expect(makeProvider().authenticate(CONNECT_OPTIONS)).rejects.toThrow("User denied");
  });

  it("uses the error param value when error_description is absent", async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce(
      successResult(callbackUrl({ error: "server_error", state: "rn-session-1" })),
    );

    await expect(makeProvider().authenticate(CONNECT_OPTIONS)).rejects.toThrow("server_error");
  });

  it("throws when code param is missing from the callback URL", async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce(
      successResult(callbackUrl({ state: "rn-session-1" })),
    );

    await expect(makeProvider().authenticate(CONNECT_OPTIONS)).rejects.toThrow("missing authorization code");
  });

  it("throws on CSRF when state is absent", async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce(successResult(callbackUrl({ code: "c" })));

    await expect(makeProvider().authenticate(CONNECT_OPTIONS)).rejects.toThrow("CSRF");
  });

  it("calls completeAuth2Exchange with the code from the callback URL", async () => {
    await makeProvider().authenticate(CONNECT_OPTIONS);

    expect(mockCompleteAuth2Exchange).toHaveBeenCalledWith(
      expect.objectContaining({
        auth2Options: AUTH2_OPTIONS,
        code: "auth-code",
        codeVerifier: "rn-code-verifier",
        provider: CONNECT_OPTIONS.provider,
      }),
    );
  });

  it("propagates errors from completeAuth2Exchange (e.g. KMS failure)", async () => {
    mockCompleteAuth2Exchange.mockRejectedValueOnce(new Error("Unable to resolve organizationId"));

    await expect(makeProvider().authenticate(CONNECT_OPTIONS)).rejects.toThrow("Unable to resolve organizationId");
  });

  it("returns a complete AuthResult including bearerToken", async () => {
    const result = await makeProvider().authenticate(CONNECT_OPTIONS);

    expect(result).toEqual({
      walletId: "wallet-rn-456",
      organizationId: "org-rn-123",
      provider: "google",
      accountDerivationIndex: 0,
      expiresInMs: 7_200_000,
      authUserId: "rn-user-1",
      bearerToken: "Bearer rn-id-token",
    });
  });

  it("uses the provider from connectOptions in the AuthResult", async () => {
    mockCompleteAuth2Exchange.mockResolvedValueOnce({
      walletId: "w",
      organizationId: "o",
      provider: "apple",
      accountDerivationIndex: 0,
      expiresInMs: 0,
      authUserId: undefined,
      bearerToken: "Bearer t",
    });

    const result = await makeProvider().authenticate({ ...CONNECT_OPTIONS, provider: "apple" });

    expect((result as AuthResult)?.provider).toBe("apple");
  });
});
