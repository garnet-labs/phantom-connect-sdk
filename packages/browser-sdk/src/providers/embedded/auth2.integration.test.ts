/**
 * Integration tests for the browser Auth2 flow.
 *
 * Tests the cooperation between Auth2Stamper (real IndexedDB via fake-indexeddb)
 * and Auth2AuthProvider. Only true external boundaries are mocked:
 *   - crypto.subtle  (key generation, signing, hashing, export)
 *   - fetch          (token exchange HTTP calls)
 *   - Auth2KmsRpcClient (KMS org/wallet discovery)
 *
 * All auth2 flow functions (prepareAuth2Flow, completeAuth2Exchange,
 * createConnectStartUrl, exchangeAuthCode, etc.) run as real code.
 */

const mockGetOrCreatePhantomOrganization = jest.fn().mockResolvedValue({ organizationId: "org-integration-123" });
const mockListPendingMigrations = jest.fn().mockResolvedValue({ pendingMigrations: [] });
const mockGetOrganizationWallets = jest.fn().mockResolvedValue({ wallets: [] });
const mockGetOrCreateWalletWithTag = jest.fn().mockResolvedValue({ walletId: "wallet-integration-456", tags: [] });

jest.mock("@phantom/auth2", () => {
  const actual = jest.requireActual<Record<string, unknown>>("@phantom/auth2");
  return {
    ...actual,
    Auth2KmsRpcClient: jest.fn().mockImplementation(() => ({
      getOrCreatePhantomOrganization: mockGetOrCreatePhantomOrganization,
      listPendingMigrations: mockListPendingMigrations,
      getOrganizationWallets: mockGetOrganizationWallets,
      getOrCreateWalletWithTag: mockGetOrCreateWalletWithTag,
    })),
  };
});

const MOCK_RAW_PUB = new Uint8Array([0x04, ...Array(64).fill(0x01)]);
const MOCK_COORD = new Uint8Array(32).fill(0x01);
const MOCK_SIG = new Uint8Array(64).fill(0x02);
const MOCK_DIGEST = new Uint8Array(32).fill(0x03);
const mockPrivateKey = { type: "private" } as CryptoKey;
const mockPublicKey = { type: "public" } as CryptoKey;

const mockSubtle = {
  generateKey: jest.fn().mockResolvedValue({ privateKey: mockPrivateKey, publicKey: mockPublicKey }),
  exportKey: jest.fn((format: string) => {
    if (format === "raw") return Promise.resolve(MOCK_RAW_PUB.buffer.slice(0) as ArrayBuffer);
    if (format === "jwk")
      return Promise.resolve({
        kty: "EC",
        crv: "P-256",
        x: Buffer.from(MOCK_COORD).toString("base64url"),
        y: Buffer.from(MOCK_COORD).toString("base64url"),
      });
    return Promise.resolve(new ArrayBuffer(0));
  }),
  sign: jest.fn().mockResolvedValue(MOCK_SIG.buffer.slice(0) as ArrayBuffer),
  digest: jest.fn().mockResolvedValue(MOCK_DIGEST.buffer.slice(0) as ArrayBuffer),
  importKey: jest.fn().mockResolvedValue(mockPrivateKey),
};

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ aud: [], ...payload })}.sig`;
}

function mockTokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () =>
      Promise.resolve({
        access_token: makeJwt({ sub: "integration-user-1" }),
        id_token: "integration-id-token",
        token_type: "Bearer",
        expires_in: 3600,
        ...overrides,
      }),
  };
}

let navigateSpy: jest.SpyInstance;

beforeEach(() => {
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: mockSubtle,
    writable: true,
    configurable: true,
  });
  mockSubtle.generateKey.mockResolvedValue({ privateKey: mockPrivateKey, publicKey: mockPublicKey });
  mockSubtle.exportKey.mockImplementation((format: string) => {
    if (format === "raw") return Promise.resolve(MOCK_RAW_PUB.buffer.slice(0) as ArrayBuffer);
    if (format === "jwk")
      return Promise.resolve({
        kty: "EC",
        crv: "P-256",
        x: Buffer.from(MOCK_COORD).toString("base64url"),
        y: Buffer.from(MOCK_COORD).toString("base64url"),
      });
    return Promise.resolve(new ArrayBuffer(0));
  });
  mockSubtle.sign.mockResolvedValue(MOCK_SIG.buffer.slice(0) as ArrayBuffer);
  mockSubtle.digest.mockResolvedValue(MOCK_DIGEST.buffer.slice(0) as ArrayBuffer);
  mockSubtle.importKey.mockResolvedValue(mockPrivateKey);
  mockGetOrCreatePhantomOrganization.mockResolvedValue({ organizationId: "org-integration-123" });
  mockListPendingMigrations.mockResolvedValue({ pendingMigrations: [] });
  mockGetOrganizationWallets.mockResolvedValue({ wallets: [] });
  mockGetOrCreateWalletWithTag.mockResolvedValue({ walletId: "wallet-integration-456", tags: [] });
  (globalThis.fetch as jest.Mock).mockResolvedValue(mockTokenResponse());
  navigateSpy = jest.spyOn(Auth2AuthProvider, "navigate").mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllMocks();
  navigateSpy.mockRestore();
});

import type { EmbeddedStorage, URLParamsAccessor } from "@phantom/embedded-provider-core";
import { Auth2Stamper } from "@phantom/auth2";
import { IndexedDBAuth2StamperStorage } from "./adapters/IndexedDBAuth2StamperStorage";
import { Auth2AuthProvider } from "./adapters/Auth2AuthProvider";

const AUTH2_OPTIONS = {
  clientId: "int-client-id",
  redirectUri: "https://app.example.com/callback",
  connectLoginUrl: "https://auth.example.com/login/start",
  authApiBaseUrl: "https://auth.example.com",
};

const KMS_OPTIONS = { apiBaseUrl: "https://kms.example.com", appId: "int-app" };

type StoredSession = Record<string, unknown> | null;

function makeStorage(session: StoredSession = null) {
  let stored = session;
  return {
    getSession: jest.fn(() => Promise.resolve(stored)),
    saveSession: jest.fn((s: Record<string, unknown>) => {
      stored = s;
      return Promise.resolve();
    }),
    clearSession: jest.fn(() => {
      stored = null;
      return Promise.resolve();
    }),
    getShouldClearPreviousSession: jest.fn().mockResolvedValue(false),
    setShouldClearPreviousSession: jest.fn().mockResolvedValue(undefined),
    _getStored: () => stored,
  };
}

function makeUrlParams(params: Record<string, string | null>) {
  return { getParam: jest.fn((k: string) => params[k] ?? null) };
}

function makeProvider(
  stamper: Auth2Stamper,
  storage: ReturnType<typeof makeStorage>,
  urlParams: ReturnType<typeof makeUrlParams>,
) {
  return new Auth2AuthProvider(
    stamper,
    storage as unknown as EmbeddedStorage,
    urlParams as unknown as URLParamsAccessor,
    AUTH2_OPTIONS,
    KMS_OPTIONS,
  );
}

describe("Auth2 browser flow — end-to-end", () => {
  it("full connect flow: stamper init → authenticate → resumeAuthFromRedirect → AuthResult", async () => {
    const sessionId = "int-session-1";
    const dbName = `int-db-${Date.now()}`;

    const stamper = new Auth2Stamper(new IndexedDBAuth2StamperStorage(dbName));
    const keyInfo = await stamper.init();
    expect(keyInfo.publicKey).toBeTruthy();

    const session = { sessionId, walletId: undefined, organizationId: undefined };
    const storage = makeStorage(session);
    const provider = makeProvider(stamper, storage, makeUrlParams({}));

    await provider.authenticate({
      publicKey: keyInfo.publicKey,
      appId: "int-app",
      sessionId,
      provider: "google",
      redirectUrl: AUTH2_OPTIONS.redirectUri,
    });

    expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining("auth.example.com"));

    const savedSession = storage._getStored();
    expect(savedSession?.pkceCodeVerifier).toBeTruthy();

    const callbackParams = makeUrlParams({ code: "callback-auth-code", state: sessionId });
    const provider2 = makeProvider(stamper, storage, callbackParams);

    const result = await provider2.resumeAuthFromRedirect("google");

    expect(result).not.toBeNull();
    expect(result!.walletId).toBe("wallet-integration-456");
    expect(result!.organizationId).toBe("org-integration-123");
    expect(result!.provider).toBe("google");
    expect(result!.accountDerivationIndex).toBe(0);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://auth.example.com/oauth2/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockGetOrCreatePhantomOrganization).toHaveBeenCalled();
    expect(mockGetOrCreateWalletWithTag).toHaveBeenCalled();
  });

  it("stamper key persists across provider instances (same IndexedDB)", async () => {
    const dbName = `persist-db-${Date.now()}`;

    const stamper1 = new Auth2Stamper(new IndexedDBAuth2StamperStorage(dbName));
    const info1 = await stamper1.init();

    const stamper2 = new Auth2Stamper(new IndexedDBAuth2StamperStorage(dbName));
    const info2 = await stamper2.init();

    expect(info2.keyId).toBe(info1.keyId);
    expect(info2.publicKey).toBe(info1.publicKey);
    expect(mockSubtle.generateKey).toHaveBeenCalledTimes(1);
  });

  it("stamp() throws before setTokens(); produces OIDC stamp after the token is set", async () => {
    const dbName = `stamp-db-${Date.now()}`;
    const stamper = new Auth2Stamper(new IndexedDBAuth2StamperStorage(dbName));
    await stamper.init();

    await expect(stamper.stamp({ type: "OIDC", data: Buffer.from("test-payload") })).rejects.toThrow("not initialized");

    await stamper.setTokens({
      accessToken: makeJwt({ sub: "test-user", ext: { a2t: "integration-id-token" } }),
      idType: "Bearer",
    });
    const stampStr = await stamper.stamp({ type: "OIDC", data: Buffer.from("test-payload") });
    const decoded = JSON.parse(Buffer.from(stampStr, "base64url").toString()) as { kind: string };

    expect(decoded.kind).toBe("OIDC");
  });

  it("resumeAuthFromRedirect returns null when no code is in the callback URL", async () => {
    const stamper = new Auth2Stamper(new IndexedDBAuth2StamperStorage(`nocode-db-${Date.now()}`));
    await stamper.init();

    const storage = makeStorage({ sessionId: "s1", pkceCodeVerifier: "v" });
    const provider = makeProvider(stamper, storage, makeUrlParams({}));

    expect(await provider.resumeAuthFromRedirect("google")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("CSRF check: resumeAuthFromRedirect throws when state does not match sessionId", async () => {
    const stamper = new Auth2Stamper(new IndexedDBAuth2StamperStorage(`csrf-db-${Date.now()}`));
    await stamper.init();

    const storage = makeStorage({ sessionId: "legit-session", pkceCodeVerifier: "v" });
    const provider = makeProvider(stamper, storage, makeUrlParams({ code: "c", state: "ATTACKER-SESSION" }));

    await expect(provider.resumeAuthFromRedirect("google")).rejects.toThrow("CSRF");
  });

  it("session is cleaned up (pkceCodeVerifier removed) after a successful redirect", async () => {
    const stamper = new Auth2Stamper(new IndexedDBAuth2StamperStorage(`cleanup-db-${Date.now()}`));
    await stamper.init();

    const storage = makeStorage({ sessionId: "s1", pkceCodeVerifier: "verifier" });
    const provider = makeProvider(stamper, storage, makeUrlParams({ code: "c", state: "s1" }));

    await provider.resumeAuthFromRedirect("google");

    const finalSession = storage._getStored();
    expect(finalSession?.pkceCodeVerifier).toBeUndefined();
    expect(finalSession?.bearerToken).toMatch(/^Bearer /);
  });

  it("getCryptoKeyPair() returns a CryptoKeyPair after stamper.init()", async () => {
    const stamper = new Auth2Stamper(new IndexedDBAuth2StamperStorage(`keypair-db-${Date.now()}`));
    expect(stamper.getCryptoKeyPair()).toBeNull();
    await stamper.init();

    const kp = stamper.getCryptoKeyPair();
    expect(kp).not.toBeNull();
    expect(kp!.privateKey).toBe(mockPrivateKey);
    expect(kp!.publicKey).toBe(mockPublicKey);
  });
});
