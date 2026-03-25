/**
 * Integration tests for the React Native (Expo) Auth2 flow.
 *
 * Tests the cooperation between Auth2Stamper (real crypto via mocked
 * expo-secure-store) and ExpoAuth2AuthProvider. Only true external
 * boundaries are mocked:
 *   - crypto.subtle  (key generation, signing, hashing, export)
 *   - fetch          (token exchange HTTP calls)
 *   - expo-secure-store / expo-web-browser (platform APIs)
 *   - Auth2KmsRpcClient (KMS org/wallet discovery)
 *
 * All auth2 flow functions (prepareAuth2Flow, completeAuth2Exchange,
 * createConnectStartUrl, exchangeAuthCode, etc.) run as real code.
 */

const mockGetOrCreatePhantomOrganization = jest.fn().mockResolvedValue({ organizationId: "org-rn-int-123" });
const mockListPendingMigrations = jest.fn().mockResolvedValue({ pendingMigrations: [] });
const mockCompleteWalletTransfer = jest.fn().mockResolvedValue(undefined);
const mockGetOrganizationWallets = jest.fn().mockResolvedValue({ wallets: [] });
const mockGetOrCreateWalletWithTag = jest.fn().mockResolvedValue({ walletId: "wallet-rn-int-456", tags: [] });

jest.mock("@phantom/auth2", () => {
  const actual = jest.requireActual<Record<string, unknown>>("@phantom/auth2");
  return {
    ...actual,
    Auth2KmsRpcClient: jest.fn().mockImplementation(() => ({
      getOrCreatePhantomOrganization: mockGetOrCreatePhantomOrganization,
      listPendingMigrations: mockListPendingMigrations,
      completeWalletTransfer: mockCompleteWalletTransfer,
      getOrganizationWallets: mockGetOrganizationWallets,
      getOrCreateWalletWithTag: mockGetOrCreateWalletWithTag,
    })),
  };
});

const MOCK_RAW_PUB = new Uint8Array([0x04, ...Array(64).fill(0xaa)]);
const MOCK_COORD = new Uint8Array(32).fill(0xaa);
const MOCK_PKCS8 = new Uint8Array(100).fill(0xbb);
const MOCK_SIG = new Uint8Array(64).fill(0xcc);
const MOCK_DIGEST_BYTES = new Uint8Array(32).fill(0xdd);

const mockPrivateKey = { type: "private", algorithm: { name: "ECDSA" } } as CryptoKey;
const mockPublicKey = { type: "public", algorithm: { name: "ECDSA" } } as CryptoKey;

const mockSubtle = {
  generateKey: jest.fn().mockResolvedValue({ privateKey: mockPrivateKey, publicKey: mockPublicKey }),
  exportKey: jest.fn((format: string) => {
    if (format === "raw") return Promise.resolve(MOCK_RAW_PUB.buffer.slice(0) as ArrayBuffer);
    if (format === "pkcs8") return Promise.resolve(MOCK_PKCS8.buffer.slice(0) as ArrayBuffer);
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
  digest: jest.fn().mockResolvedValue(MOCK_DIGEST_BYTES.buffer.slice(0) as ArrayBuffer),
  importKey: jest.fn().mockResolvedValue(mockPrivateKey),
};

/** Builds a minimal JWT with a base64url-encoded payload (no real signature). */
function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ aud: [], ...payload })}.sig`;
}

function makeA2tJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  return makeJwt({ exp: now + 3600, iat: now });
}

function mockTokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () =>
      Promise.resolve({
        // Real JWT format so parseClaims (jwtDecode) can extract ext.a2t and sub claims.
        access_token: makeJwt({ sub: "rn-user", ext: { a2t: makeA2tJwt() } }),
        token_type: "Bearer",
        expires_in: 7200,
        ...overrides,
      }),
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: mockSubtle,
    writable: true,
    configurable: true,
  });
  mockSubtle.generateKey.mockResolvedValue({ privateKey: mockPrivateKey, publicKey: mockPublicKey });
  mockSubtle.exportKey.mockImplementation((format: string) => {
    if (format === "raw") return Promise.resolve(MOCK_RAW_PUB.buffer.slice(0) as ArrayBuffer);
    if (format === "pkcs8") return Promise.resolve(MOCK_PKCS8.buffer.slice(0) as ArrayBuffer);
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
  mockSubtle.digest.mockResolvedValue(MOCK_DIGEST_BYTES.buffer.slice(0) as ArrayBuffer);
  mockSubtle.importKey.mockResolvedValue(mockPrivateKey);
  mockGetOrCreatePhantomOrganization.mockResolvedValue({ organizationId: "org-rn-int-123" });
  mockListPendingMigrations.mockResolvedValue({ pendingMigrations: [] });
  mockCompleteWalletTransfer.mockResolvedValue(undefined);
  mockGetOrganizationWallets.mockResolvedValue({ wallets: [] });
  mockGetOrCreateWalletWithTag.mockResolvedValue({ walletId: "wallet-rn-int-456", tags: [] });
  (globalThis as any).fetch = jest.fn().mockResolvedValue(mockTokenResponse());
  jest.clearAllMocks();
});

import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { Auth2Stamper } from "@phantom/auth2";
import { SecureStoreAuth2StamperStorage } from "./SecureStoreAuth2StamperStorage";
import { ExpoAuth2AuthProvider } from "./ExpoAuth2AuthProvider";

const AUTH2_OPTIONS = {
  clientId: "rn-int-client-id",
  redirectUri: "myapp://callback",
  connectLoginUrl: "https://auth.example.com/login/start",
  authApiBaseUrl: "https://auth.example.com",
};
const KMS_OPTIONS = { apiBaseUrl: "https://kms.example.com", appId: "rn-int-app" };

const CONNECT_OPTIONS = {
  publicKey: "7EcDshMsTHCs2f2HU2a3n36x9JkEVVenF9oQQGy5U3s",
  appId: "rn-int-app",
  sessionId: "rn-int-session-1",
  provider: "google" as const,
  redirectUrl: "myapp://callback",
};

function buildCallbackUrl(params: Record<string, string>) {
  const url = new URL("myapp://callback");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

type StamperArg = ConstructorParameters<typeof ExpoAuth2AuthProvider>[0];

function makeProvider(stamper: Auth2Stamper) {
  return new ExpoAuth2AuthProvider(stamper as unknown as StamperArg, AUTH2_OPTIONS, KMS_OPTIONS);
}

describe("ExpoAuth2 React Native flow — end-to-end", () => {
  beforeEach(() => {
    (WebBrowser.warmUpAsync as jest.Mock).mockResolvedValue(undefined);
    (WebBrowser.coolDownAsync as jest.Mock).mockResolvedValue(undefined);
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: "success",
      url: buildCallbackUrl({ code: "rn-auth-code", state: "rn-int-session-1" }),
    });
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    mockGetOrCreatePhantomOrganization.mockResolvedValue({ organizationId: "org-rn-int-123" });
    mockListPendingMigrations.mockResolvedValue({ pendingMigrations: [] });
    mockCompleteWalletTransfer.mockResolvedValue(undefined);
    mockGetOrganizationWallets.mockResolvedValue({ wallets: [] });
    mockGetOrCreateWalletWithTag.mockResolvedValue({ walletId: "wallet-rn-int-456", tags: [] });
    (globalThis as any).fetch = jest.fn().mockResolvedValue(mockTokenResponse());
  });

  it("full connect flow: stamper init → authenticate → AuthResult", async () => {
    const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage("phantom-auth2-rn-int"));
    const provider = makeProvider(stamper);

    const result = await provider.authenticate(CONNECT_OPTIONS);

    expect(stamper.getKeyInfo()).not.toBeNull();

    expect(result).toEqual(
      expect.objectContaining({
        walletId: "wallet-rn-int-456",
        organizationId: "org-rn-int-123",
        provider: "google",
        accountDerivationIndex: 0,
      }),
    );
  });

  it("calls fetch to exchange the authorization code", async () => {
    const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage("phantom-auth2-rn-code"));
    const provider = makeProvider(stamper);
    await provider.authenticate(CONNECT_OPTIONS);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://auth.example.com/oauth2/token",
      expect.objectContaining({ method: "POST" }),
    );
    const body = new URLSearchParams(
      ((globalThis.fetch as jest.Mock).mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.get("code")).toBe("rn-auth-code");
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("passes the auth URL to openAuthSessionAsync", async () => {
    const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage("phantom-auth2-rn-url-passthrough"));
    const provider = makeProvider(stamper);
    await provider.authenticate(CONNECT_OPTIONS);

    const [authUrl] = (WebBrowser.openAuthSessionAsync as jest.Mock).mock.calls[0] as [string, string];
    expect(authUrl).toContain("auth.example.com");
  });

  it("getCryptoKeyPair() returns a CryptoKeyPair after stamper init", async () => {
    const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage("phantom-auth2-keypair-int"));
    expect(stamper.getCryptoKeyPair()).toBeNull();
    await stamper.init();
    const kp = stamper.getCryptoKeyPair();
    expect(kp).not.toBeNull();
    expect(kp!.privateKey).toBe(mockPrivateKey);
    expect(kp!.publicKey).toBe(mockPublicKey);
  });

  it("stamper key persists to SecureStore during authentication", async () => {
    const storageKey = "phantom-auth2-persist-test";
    const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage(storageKey));
    const provider = makeProvider(stamper);
    await provider.authenticate(CONNECT_OPTIONS);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      storageKey,
      expect.stringContaining("privateKeyPkcs8"),
      expect.any(Object),
    );
  });

  it("loads the stored key from SecureStore on re-initialisation (simulates app restart)", async () => {
    const storageKey = "phantom-auth2-reload-test";
    const stamper1 = new Auth2Stamper(new SecureStoreAuth2StamperStorage(storageKey));
    const provider1 = makeProvider(stamper1);
    await provider1.authenticate(CONNECT_OPTIONS);

    const info1 = stamper1.getKeyInfo();
    expect(info1).not.toBeNull();

    const storedJson = (SecureStore.setItemAsync as jest.Mock).mock.calls.slice(-1)[0][1] as string;
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(storedJson);

    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce({
      type: "success",
      url: buildCallbackUrl({ code: "second-auth-code", state: "rn-int-session-1" }),
    });

    const stamper2 = new Auth2Stamper(new SecureStoreAuth2StamperStorage(storageKey));
    const provider2 = makeProvider(stamper2);
    await provider2.authenticate(CONNECT_OPTIONS);

    expect(mockSubtle.generateKey).toHaveBeenCalledTimes(1);
    expect(stamper2.getKeyInfo()?.keyId).toBe(info1!.keyId);
  });

  it("throws and cooldown still runs when user cancels the browser session", async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce({ type: "cancel" });

    const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage("phantom-auth2-cancel"));
    const provider = makeProvider(stamper);

    await expect(provider.authenticate(CONNECT_OPTIONS)).rejects.toThrow("Authentication failed");
    expect(WebBrowser.coolDownAsync).toHaveBeenCalled();
  });

  it("stamp() succeeds after authentication (stamper is armed with tokens)", async () => {
    const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage("phantom-auth2-stamp-int"));
    const provider = makeProvider(stamper);
    await provider.authenticate(CONNECT_OPTIONS);

    const stampStr = await stamper.stamp({ type: "OIDC", data: Buffer.from("integration-payload") });
    expect(typeof stampStr).toBe("string");
    expect(stampStr.length).toBeGreaterThan(0);
  });

  it("CSRF: throws when callback state does not match the session ID", async () => {
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValueOnce({
      type: "success",
      url: buildCallbackUrl({ code: "c", state: "ATTACKER-SESSION" }),
    });

    const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage("phantom-auth2-csrf"));
    const provider = makeProvider(stamper);

    await expect(provider.authenticate(CONNECT_OPTIONS)).rejects.toThrow("CSRF");
  });

  it("KMS org discovery is called after token exchange", async () => {
    const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage("phantom-auth2-kms"));
    const provider = makeProvider(stamper);
    await provider.authenticate(CONNECT_OPTIONS);

    expect(mockGetOrCreatePhantomOrganization).toHaveBeenCalled();
    expect(mockGetOrCreateWalletWithTag).toHaveBeenCalled();
  });
});
