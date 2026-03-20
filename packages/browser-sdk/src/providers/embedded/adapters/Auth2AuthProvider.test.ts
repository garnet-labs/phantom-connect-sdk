const mockPrepareAuth2Flow = jest.fn().mockResolvedValue({
  url: "https://auth.example.com/login/start?client_id=client-id&state=session-id-1",
  codeVerifier: "test-code-verifier",
  keyPair: { privateKey: {}, publicKey: {} },
});

const mockCompleteAuth2Exchange = jest.fn().mockResolvedValue({
  walletId: "wallet-456",
  organizationId: "org-123",
  provider: "google",
  accountDerivationIndex: 0,
  expiresInMs: 3_600_000,
  authUserId: "auth-user-1",
  bearerToken: "Bearer access-token",
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

import type { StamperWithKeyManagement } from "@phantom/sdk-types";
import type { EmbeddedStorage, URLParamsAccessor } from "@phantom/embedded-provider-core";
import { Auth2AuthProvider } from "./Auth2AuthProvider";

type TestSession = {
  sessionId: string;
  pkceCodeVerifier?: string;
  bearerToken?: string;
  authUserId?: string;
  walletId?: string;
  organizationId?: string;
  status?: string;
  [key: string]: unknown;
};

function makeStorage(initialSession: TestSession | null = null) {
  let session: TestSession | null = initialSession;
  return {
    getSession: jest.fn().mockImplementation(() => Promise.resolve(session)),
    saveSession: jest.fn().mockImplementation((s: TestSession) => {
      session = s;
      return Promise.resolve();
    }),
    clearSession: jest.fn().mockResolvedValue(undefined),
    getShouldClearPreviousSession: jest.fn().mockResolvedValue(false),
    setShouldClearPreviousSession: jest.fn().mockResolvedValue(undefined),
  };
}

function makeUrlParams(params: Record<string, string | null> = {}) {
  return {
    getParam: jest.fn((key: string) => params[key] ?? null),
  };
}

function makeStamper(initialized = true) {
  return {
    stamp: jest.fn(),
    getKeyInfo: jest
      .fn()
      .mockReturnValue(initialized ? { keyId: "k1", publicKey: "pub", createdAt: Date.now() } : null),
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

const AUTH2_OPTIONS = {
  clientId: "client-id",
  redirectUri: "https://app.example.com/callback",
  connectLoginUrl: "https://auth.example.com/login/start",
  authApiBaseUrl: "https://auth.example.com",
};

const KMS_OPTIONS = {
  apiBaseUrl: "https://kms.example.com",
  appId: "app-id",
};

function makeProvider(
  storage = makeStorage({ sessionId: "session-id-1" }),
  urlParams = makeUrlParams(),
  stamper = makeStamper(),
) {
  return new Auth2AuthProvider(
    stamper as unknown as StamperWithKeyManagement,
    storage as unknown as EmbeddedStorage,
    urlParams as unknown as URLParamsAccessor,
    AUTH2_OPTIONS,
    KMS_OPTIONS,
  );
}

describe("Auth2AuthProvider.authenticate()", () => {
  const connectOptions = {
    publicKey: "7EcDshMsTHCs2f2HU2a3n36x9JkEVVenF9oQQGy5U3s",
    appId: "app-id",
    sessionId: "session-id-1",
    provider: "google" as const,
    redirectUrl: "https://app.example.com/callback",
  };

  let navigateSpy: jest.SpyInstance;

  beforeEach(() => {
    navigateSpy = jest.spyOn(Auth2AuthProvider, "navigate").mockImplementation(() => {});
    mockPrepareAuth2Flow.mockResolvedValue({
      url: "https://auth.example.com/login/start?client_id=client-id&state=session-id-1",
      codeVerifier: "test-code-verifier",
      keyPair: { privateKey: {}, publicKey: {} },
    });
  });

  afterEach(() => {
    navigateSpy.mockRestore();
    jest.clearAllMocks();
  });

  it("throws when no session exists", async () => {
    const storage = makeStorage(null);

    await expect(makeProvider(storage).authenticate(connectOptions)).rejects.toThrow("Session not found.");
  });

  it("calls prepareAuth2Flow with the stamper and auth options", async () => {
    await makeProvider().authenticate(connectOptions);

    expect(mockPrepareAuth2Flow).toHaveBeenCalledWith(
      expect.objectContaining({
        auth2Options: AUTH2_OPTIONS,
        sessionId: connectOptions.sessionId,
        provider: connectOptions.provider,
      }),
    );
  });

  it("saves pkceCodeVerifier into the existing session", async () => {
    const session: TestSession = { sessionId: "session-id-1" };
    const storage = makeStorage(session);

    await makeProvider(storage).authenticate(connectOptions);

    expect(storage.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ pkceCodeVerifier: "test-code-verifier" }),
    );
  });

  it("navigates to the URL returned by prepareAuth2Flow", async () => {
    const expectedUrl = "https://auth.example.com/login/start?foo=bar";
    mockPrepareAuth2Flow.mockResolvedValueOnce({ url: expectedUrl, codeVerifier: "v", keyPair: {} });

    await makeProvider().authenticate(connectOptions);

    expect(navigateSpy).toHaveBeenCalledWith(expectedUrl);
  });

  it("propagates errors from prepareAuth2Flow (e.g. missing key pair)", async () => {
    mockPrepareAuth2Flow.mockRejectedValueOnce(new Error("Stamper key pair not found."));

    await expect(makeProvider().authenticate(connectOptions)).rejects.toThrow("Stamper key pair not found.");
  });

  it("passes provider=google to prepareAuth2Flow", async () => {
    await makeProvider().authenticate({ ...connectOptions, provider: "google" });
    expect(mockPrepareAuth2Flow).toHaveBeenCalledWith(expect.objectContaining({ provider: "google" }));
  });

  it("passes provider=apple to prepareAuth2Flow", async () => {
    await makeProvider().authenticate({ ...connectOptions, provider: "apple" });
    expect(mockPrepareAuth2Flow).toHaveBeenCalledWith(expect.objectContaining({ provider: "apple" }));
  });

  it("passes provider=phantom to prepareAuth2Flow", async () => {
    await makeProvider().authenticate({ ...connectOptions, provider: "phantom" });
    expect(mockPrepareAuth2Flow).toHaveBeenCalledWith(expect.objectContaining({ provider: "phantom" }));
  });

  it("passes provider=device to prepareAuth2Flow", async () => {
    await makeProvider().authenticate({ ...connectOptions, provider: "device" });
    expect(mockPrepareAuth2Flow).toHaveBeenCalledWith(expect.objectContaining({ provider: "device" }));
  });
});

describe("Auth2AuthProvider.resumeAuthFromRedirect()", () => {
  const SESSION: TestSession = {
    sessionId: "session-abc",
    pkceCodeVerifier: "verifier-xyz",
  };

  beforeEach(() => {
    mockCompleteAuth2Exchange.mockResolvedValue({
      walletId: "wallet-456",
      organizationId: "org-123",
      provider: "google",
      accountDerivationIndex: 0,
      expiresInMs: 3_600_000,
      authUserId: "auth-user-1",
      bearerToken: "Bearer access-token",
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function makeSuccessProvider() {
    return makeProvider(makeStorage({ ...SESSION }), makeUrlParams({ code: "auth-code", state: "session-abc" }));
  }

  it("returns null when the URL has no 'code' param", async () => {
    const provider = makeProvider(makeStorage(SESSION), makeUrlParams({}));

    expect(await provider.resumeAuthFromRedirect("google")).toBeNull();
  });

  it("throws when no session exists and a code is present in the URL", async () => {
    const provider = makeProvider(makeStorage(null), makeUrlParams({ code: "auth-code" }));

    await expect(provider.resumeAuthFromRedirect("google")).rejects.toThrow("Session not found.");
  });

  it("returns null when the session has no pkceCodeVerifier", async () => {
    const session = { sessionId: "s1" };
    const provider = makeProvider(makeStorage(session), makeUrlParams({ code: "code", state: "s1" }));

    expect(await provider.resumeAuthFromRedirect("google")).toBeNull();
  });

  it("calls stamper.init() when the stamper is not yet loaded", async () => {
    const stamper = makeStamper(false);
    const provider = makeProvider(
      makeStorage({ ...SESSION }),
      makeUrlParams({ code: "c", state: "session-abc" }),
      stamper,
    );

    await provider.resumeAuthFromRedirect("google");

    expect(stamper.init).toHaveBeenCalled();
  });

  it("does not call stamper.init() when the stamper is already loaded", async () => {
    const stamper = makeStamper(true);
    const provider = makeProvider(
      makeStorage({ ...SESSION }),
      makeUrlParams({ code: "c", state: "session-abc" }),
      stamper,
    );

    await provider.resumeAuthFromRedirect("google");

    expect(stamper.init).not.toHaveBeenCalled();
  });

  it("throws on state mismatch (CSRF protection)", async () => {
    const provider = makeProvider(makeStorage({ ...SESSION }), makeUrlParams({ code: "c", state: "WRONG-state" }));

    await expect(provider.resumeAuthFromRedirect("google")).rejects.toThrow("CSRF");
  });

  it("throws when the callback URL contains an error param", async () => {
    const provider = makeProvider(
      makeStorage({ ...SESSION }),
      makeUrlParams({ code: "c", state: "session-abc", error: "access_denied", error_description: "User denied" }),
    );

    await expect(provider.resumeAuthFromRedirect("google")).rejects.toThrow("User denied");
  });

  it("throws when error param is present but error_description is absent", async () => {
    const provider = makeProvider(
      makeStorage({ ...SESSION }),
      makeUrlParams({ code: "c", state: "session-abc", error: "server_error" }),
    );

    await expect(provider.resumeAuthFromRedirect("google")).rejects.toThrow("server_error");
  });

  it("calls completeAuth2Exchange with the code and codeVerifier", async () => {
    await makeSuccessProvider().resumeAuthFromRedirect("google");

    expect(mockCompleteAuth2Exchange).toHaveBeenCalledWith(
      expect.objectContaining({
        auth2Options: AUTH2_OPTIONS,
        code: "auth-code",
        codeVerifier: "verifier-xyz",
        provider: "google",
      }),
    );
  });

  it("saves bearerToken, authUserId, status=completed to the session and clears pkceCodeVerifier", async () => {
    const storage = makeStorage({ ...SESSION });
    const provider = makeProvider(storage, makeUrlParams({ code: "c", state: "session-abc" }));

    await provider.resumeAuthFromRedirect("google");

    expect(storage.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        bearerToken: "Bearer access-token",
        authUserId: "auth-user-1",
        pkceCodeVerifier: undefined,
        status: "completed",
      }),
    );
  });

  it("returns a complete AuthResult on success", async () => {
    const result = await makeSuccessProvider().resumeAuthFromRedirect("google");

    expect(result).toEqual({
      walletId: "wallet-456",
      organizationId: "org-123",
      provider: "google",
      accountDerivationIndex: 0,
      expiresInMs: 3_600_000,
      authUserId: "auth-user-1",
      bearerToken: "Bearer access-token",
    });
  });

  it("propagates errors from completeAuth2Exchange (e.g. KMS failure)", async () => {
    mockCompleteAuth2Exchange.mockRejectedValueOnce(new Error("Unable to resolve organizationId"));

    await expect(makeSuccessProvider().resumeAuthFromRedirect("google")).rejects.toThrow(
      "Unable to resolve organizationId",
    );
  });

  it("throws when state param is absent (CSRF protection requires state)", async () => {
    const provider = makeProvider(makeStorage({ ...SESSION }), makeUrlParams({ code: "c" }));

    await expect(provider.resumeAuthFromRedirect("google")).rejects.toThrow("CSRF");
  });
});
