const mockBase64urlEncode = jest.fn((data: Uint8Array) => Buffer.from(data).toString("base64url"));
jest.mock("@phantom/base64url", () => ({
  base64urlEncode: mockBase64urlEncode,
}));

const mockJwtDecode = jest.fn();
jest.mock("jwt-decode", () => ({
  jwtDecode: mockJwtDecode,
}));

import { Auth2Stamper } from "../Auth2Stamper";
import type { Auth2StamperStorage, Auth2StamperStoredRecord } from "../Auth2StamperStorage";

const MOCK_RAW_PUBLIC_KEY = new Uint8Array([0x04, ...Array(64).fill(0x11)]);
const MOCK_SIGNATURE = new Uint8Array(64).fill(0x22);
const MOCK_DIGEST = new Uint8Array(32).fill(0x33);

const mockPrivateKey = { type: "private", algorithm: { name: "ECDSA" } } as CryptoKey;
const mockPublicKey = { type: "public", algorithm: { name: "ECDSA" } } as CryptoKey;
const mockKeyPair: CryptoKeyPair = { privateKey: mockPrivateKey, publicKey: mockPublicKey };

const mockSubtle = {
  generateKey: jest.fn().mockResolvedValue(mockKeyPair),
  exportKey: jest.fn((format: string) => {
    if (format === "raw") return Promise.resolve(MOCK_RAW_PUBLIC_KEY.buffer.slice(0) as ArrayBuffer);
    return Promise.resolve(new ArrayBuffer(0));
  }),
  sign: jest.fn().mockResolvedValue(MOCK_SIGNATURE.buffer.slice(0) as ArrayBuffer),
  digest: jest.fn().mockResolvedValue(MOCK_DIGEST.buffer.slice(0) as ArrayBuffer),
};

const DEFAULT_JWT_CLAIMS = { sub: "default-user", ext: { a2t: "default-auth2-token" }, aud: [] as string[] };

beforeEach(() => {
  mockBase64urlEncode.mockImplementation((data: Uint8Array) => Buffer.from(data).toString("base64url"));
  mockJwtDecode.mockReturnValue(DEFAULT_JWT_CLAIMS);
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: mockSubtle,
    writable: true,
    configurable: true,
  });
  mockSubtle.generateKey.mockResolvedValue(mockKeyPair);
  mockSubtle.exportKey.mockImplementation((format: string) => {
    if (format === "raw") return Promise.resolve(MOCK_RAW_PUBLIC_KEY.buffer.slice(0) as ArrayBuffer);
    return Promise.resolve(new ArrayBuffer(0));
  });
  mockSubtle.sign.mockResolvedValue(MOCK_SIGNATURE.buffer.slice(0) as ArrayBuffer);
  mockSubtle.digest.mockResolvedValue(MOCK_DIGEST.buffer.slice(0) as ArrayBuffer);
});

function makeStorage(record: Auth2StamperStoredRecord | null = null): jest.Mocked<Required<Auth2StamperStorage>> {
  return {
    open: jest.fn().mockResolvedValue(undefined),
    load: jest.fn().mockResolvedValue(record),
    save: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    requiresExtractableKeys: false,
  };
}

const STORED_RECORD: Auth2StamperStoredRecord = {
  keyPair: mockKeyPair,
  keyInfo: { keyId: "stored-key-id", publicKey: "StoredBase58PublicKey", createdAt: 1_000_000 },
  accessToken: "stored-access-token",
  idType: "Bearer",
  refreshToken: "stored-refresh-token",
  tokenExpiresAt: Date.now() + 3_600_000,
};

describe("Auth2Stamper", () => {
  describe("init()", () => {
    it("calls storage.open() when the method exists", async () => {
      const storage = makeStorage();
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      expect(storage.open).toHaveBeenCalledTimes(1);
    });

    it("skips storage.open() when the method is undefined", async () => {
      const storage = makeStorage();
      delete (storage as any).open;
      const stamper = new Auth2Stamper(storage);

      await expect(stamper.init()).resolves.toBeTruthy();
    });

    it("generates a new key pair when storage is empty", async () => {
      const storage = makeStorage(null);
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      expect(mockSubtle.generateKey).toHaveBeenCalled();
      expect(storage.save).toHaveBeenCalledWith(expect.objectContaining({ keyPair: mockKeyPair }));
    });

    it("loads existing record from storage without generating", async () => {
      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage);

      const keyInfo = await stamper.init();

      expect(mockSubtle.generateKey).not.toHaveBeenCalled();
      expect(keyInfo.keyId).toBe("stored-key-id");
    });

    it("restores tokens from the stored record", async () => {
      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      // bearerToken is derived directly from the stored access token and idType.
      expect(stamper.bearerToken).toBe("Bearer stored-access-token");
      // auth2Token.sub comes from the jwtDecode mock applied to the stored access token.
      expect(stamper.auth2Token?.sub).toBe("default-user");
    });

    it("passes requiresExtractableKeys to crypto.subtle.generateKey", async () => {
      const storage = makeStorage();
      (storage as any).requiresExtractableKeys = true;
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      expect(mockSubtle.generateKey).toHaveBeenCalledWith({ name: "ECDSA", namedCurve: "P-256" }, true, [
        "sign",
        "verify",
      ]);
    });

    it("passes requiresExtractableKeys=false for non-extractable storage", async () => {
      const storage = makeStorage();
      storage.requiresExtractableKeys = false;
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      expect(mockSubtle.generateKey).toHaveBeenCalledWith({ name: "ECDSA", namedCurve: "P-256" }, false, [
        "sign",
        "verify",
      ]);
    });

    it("returns keyInfo with keyId derived from SHA-256 of the raw public key", async () => {
      const storage = makeStorage();
      const stamper = new Auth2Stamper(storage);

      const keyInfo = await stamper.init();

      const expected = Buffer.from(MOCK_DIGEST).toString("base64url").substring(0, 16);
      expect(keyInfo.keyId).toBe(expected);
    });
  });

  describe("getKeyInfo() / getCryptoKeyPair()", () => {
    it("returns null before init()", () => {
      const stamper = new Auth2Stamper(makeStorage());
      expect(stamper.getKeyInfo()).toBeNull();
      expect(stamper.getCryptoKeyPair()).toBeNull();
    });

    it("returns values after init()", async () => {
      const stamper = new Auth2Stamper(makeStorage());

      await stamper.init();

      expect(stamper.getKeyInfo()).not.toBeNull();
      expect(stamper.getCryptoKeyPair()).toEqual(mockKeyPair);
    });
  });

  describe("bearerToken / auth2Token getters", () => {
    it("bearerToken returns null before setTokens()", async () => {
      const stamper = new Auth2Stamper(makeStorage());

      await stamper.init();

      expect(stamper.bearerToken).toBeNull();
    });

    it("bearerToken returns '{idType} {accessToken}' after setTokens()", async () => {
      const storage = makeStorage();
      const stamper = new Auth2Stamper(storage);

      await stamper.init();
      storage.load.mockResolvedValueOnce({ keyPair: mockKeyPair, keyInfo: stamper.getKeyInfo()! });

      await stamper.setTokens({ accessToken: "access-1", idType: "Bearer", refreshToken: "r" });

      expect(stamper.bearerToken).toBe("Bearer access-1");
    });

    it("bearerToken returns null after clear()", async () => {
      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage);

      await stamper.init();
      await stamper.clear();

      expect(stamper.bearerToken).toBeNull();
    });

    it("auth2Token returns null before setTokens()", async () => {
      const stamper = new Auth2Stamper(makeStorage());

      await stamper.init();

      expect(stamper.auth2Token).toBeNull();
    });

    it("auth2Token returns an Auth2Token instance with sub from the access token", async () => {
      const storage = makeStorage();
      const stamper = new Auth2Stamper(storage);

      await stamper.init();
      storage.load.mockResolvedValueOnce({ keyPair: mockKeyPair, keyInfo: stamper.getKeyInfo()! });

      // Set a specific sub for this test.
      mockJwtDecode.mockReturnValue({ sub: "user-abc", ext: { a2t: "tok-abc" }, aud: [] });
      await stamper.setTokens({ accessToken: "access-abc", idType: "Bearer" });

      expect(stamper.auth2Token?.sub).toBe("user-abc");
    });

    it("auth2Token returns null after clear()", async () => {
      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage);

      await stamper.init();
      await stamper.clear();

      expect(stamper.auth2Token).toBeNull();
    });

    it("does not refresh when token is well within the expiry buffer", async () => {
      const mockFetch = globalThis.fetch as jest.Mock;

      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage, {
        authApiBaseUrl: "https://auth.example.com",
        clientId: "c",
        redirectUri: "https://app.example.com/cb",
      });

      await stamper.init();

      // Token expires far in the future — no refresh needed.
      (stamper as any)._tokenExpiresAt = Date.now() + 3_600_000;

      stamper.bearerToken;

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not refresh when _refreshToken is null even if config is set and token expired", async () => {
      const mockFetch = globalThis.fetch as jest.Mock;

      const recordWithoutRefresh = { ...STORED_RECORD, refreshToken: undefined };
      const storage = makeStorage(recordWithoutRefresh);
      const stamper = new Auth2Stamper(storage, {
        authApiBaseUrl: "https://auth.example.com",
        clientId: "c",
        redirectUri: "https://app.example.com/cb",
      });

      await stamper.init();

      (stamper as any)._tokenExpiresAt = Date.now() - 1000;
      (stamper as any)._refreshToken = null;

      stamper.bearerToken;

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("setTokens()", () => {
    it("persists tokens to storage by merging with existing record", async () => {
      const storage = makeStorage();
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      const existingRecord = { keyPair: mockKeyPair, keyInfo: stamper.getKeyInfo()! };
      storage.load.mockResolvedValueOnce(existingRecord);

      await stamper.setTokens({ accessToken: "tok", idType: "Bearer", refreshToken: "ref", expiresInMs: 5000 });

      expect(storage.save).toHaveBeenCalledWith(
        expect.objectContaining({
          keyPair: mockKeyPair,
          accessToken: "tok",
          idType: "Bearer",
          refreshToken: "ref",
          tokenExpiresAt: expect.any(Number),
        }),
      );
    });

    it("clears a previously set refreshToken when called without one", async () => {
      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      // First call sets a refresh token.
      storage.load.mockResolvedValueOnce({ keyPair: mockKeyPair, keyInfo: stamper.getKeyInfo()! });
      await stamper.setTokens({ accessToken: "access-a", idType: "Bearer", refreshToken: "r" });
      expect((stamper as any)._refreshToken).toBe("r");

      // Second call omits refreshToken — should clear it.
      storage.load.mockResolvedValueOnce({ keyPair: mockKeyPair, keyInfo: stamper.getKeyInfo()! });
      await stamper.setTokens({ accessToken: "access-b", idType: "Bearer" });
      expect((stamper as any)._refreshToken).toBeNull();
    });

    it("does not call storage.save when no existing record is found", async () => {
      const storage = makeStorage();
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      storage.load.mockResolvedValueOnce(null);
      storage.save.mockClear();

      await stamper.setTokens({ accessToken: "t", idType: "Bearer" });

      expect(storage.save).not.toHaveBeenCalled();
    });
  });

  describe("stamp()", () => {
    it("throws before init()", async () => {
      const stamper = new Auth2Stamper(makeStorage());

      await expect(stamper.stamp({ type: "OIDC", data: Buffer.from("x") })).rejects.toThrow("not initialized");
    });

    it("throws when initialized but no token set", async () => {
      const stamper = new Auth2Stamper(makeStorage());

      await stamper.init();

      await expect(stamper.stamp({ type: "OIDC", data: Buffer.from("x") })).rejects.toThrow("not initialized");
    });

    it("produces an OIDC stamp after init + setTokens", async () => {
      const storage = makeStorage();
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      storage.load.mockResolvedValueOnce({ keyPair: mockKeyPair, keyInfo: stamper.getKeyInfo()! });

      // auth2Token getter calls jwtDecode on each access; override the default for this test.
      mockJwtDecode.mockReturnValue({ sub: "user-1", ext: { a2t: "my-auth2-token" }, aud: [] });
      await stamper.setTokens({ accessToken: "my-access-token", idType: "Bearer" });

      const stampStr = await stamper.stamp({ type: "OIDC", data: Buffer.from("payload") });

      const decoded = JSON.parse(Buffer.from(stampStr, "base64url").toString()) as {
        kind: string;
        idToken: string;
        algorithm: string;
        salt: unknown;
        publicKey: string;
        signature: string;
      };

      expect(decoded.kind).toBe("OIDC");
      expect(decoded.idToken).toBe("my-auth2-token");
      expect(decoded.algorithm).toBe("Secp256r1");
      expect(decoded.salt).toBe("");
      expect(typeof decoded.publicKey).toBe("string");
      expect(decoded.publicKey.length).toBeGreaterThan(0);
      expect(typeof decoded.signature).toBe("string");
      expect(decoded.signature.length).toBeGreaterThan(0);
    });

    it("signs with ECDSA P-256 / SHA-256", async () => {
      const storage = makeStorage();
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      storage.load.mockResolvedValueOnce({ keyPair: mockKeyPair, keyInfo: stamper.getKeyInfo()! });
      await stamper.setTokens({ accessToken: "access", idType: "Bearer" });

      await stamper.stamp({ type: "OIDC", data: Buffer.from("data") });

      expect(mockSubtle.sign).toHaveBeenCalledWith(
        { name: "ECDSA", hash: "SHA-256" },
        mockPrivateKey,
        expect.any(Uint8Array),
      );
    });
  });

  describe("resetKeyPair()", () => {
    it("clears storage and generates a fresh key pair", async () => {
      const storage = makeStorage();
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      storage.load.mockResolvedValueOnce({ keyPair: mockKeyPair, keyInfo: stamper.getKeyInfo()! });
      await stamper.setTokens({ accessToken: "access", idType: "Bearer" });

      await stamper.resetKeyPair();

      expect(storage.clear).toHaveBeenCalled();
      expect(mockSubtle.generateKey).toHaveBeenCalledTimes(2);
      expect(stamper.bearerToken).toBeNull();
    });
  });

  describe("clear()", () => {
    it("clears storage and resets all in-memory state", async () => {
      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      await stamper.clear();

      expect(storage.clear).toHaveBeenCalled();
      expect(stamper.getKeyInfo()).toBeNull();
      expect(stamper.getCryptoKeyPair()).toBeNull();
      expect(stamper.bearerToken).toBeNull();
      expect(stamper.auth2Token).toBeNull();
    });
  });

  describe("rotation methods", () => {
    it("rotateKeyPair() throws", async () => {
      const stamper = new Auth2Stamper(makeStorage());
      await expect(stamper.rotateKeyPair()).rejects.toThrow("not supported");
    });

    it("commitRotation() throws", async () => {
      const stamper = new Auth2Stamper(makeStorage());
      await expect(stamper.commitRotation("id")).rejects.toThrow("not supported");
    });

    it("rollbackRotation() throws", async () => {
      const stamper = new Auth2Stamper(makeStorage());
      await expect(stamper.rollbackRotation()).rejects.toThrow("not supported");
    });
  });

  describe("maybeRefreshTokens()", () => {
    it("returns true and updates bearerToken after a successful refresh", async () => {
      const mockFetch = globalThis.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "forced-new-access",
            refresh_token: "forced-new-refresh",
            token_type: "Bearer",
            expires_in: 3600,
          }),
      });

      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage, {
        authApiBaseUrl: "https://auth.example.com",
        clientId: "client-1",
        redirectUri: "https://app.example.com/callback",
      });
      await stamper.init();
      (stamper as any)._tokenExpiresAt = Date.now() - 1000;

      const result = await stamper.maybeRefreshTokens();

      expect(result).toBe(true);
      expect(stamper.bearerToken).toBe("Bearer forced-new-access");
    });

    it("returns false when no refreshToken is available", async () => {
      const storage = makeStorage({ ...STORED_RECORD, refreshToken: undefined });
      const stamper = new Auth2Stamper(storage, {
        authApiBaseUrl: "https://auth.example.com",
        clientId: "client-1",
        redirectUri: "https://app.example.com/callback",
      });
      await stamper.init();
      (stamper as any)._refreshToken = null;

      const result = await stamper.maybeRefreshTokens();

      expect(result).toBe(false);
    });

    it("returns false when no refreshConfig is provided", async () => {
      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage); // no refreshConfig
      await stamper.init();

      const result = await stamper.maybeRefreshTokens();

      expect(result).toBe(false);
    });

    it("returns false and does not throw when the refresh request fails", async () => {
      const mockFetch = globalThis.fetch as jest.Mock;
      mockFetch.mockRejectedValueOnce(new Error("network error"));

      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage, {
        authApiBaseUrl: "https://auth.example.com",
        clientId: "client-1",
        redirectUri: "https://app.example.com/callback",
      });
      await stamper.init();
      (stamper as any)._refreshToken = "stored-refresh-token";
      (stamper as any)._tokenExpiresAt = Date.now() - 1000;

      const result = await stamper.maybeRefreshTokens();

      expect(result).toBe(false);
      // bearerToken unchanged — still the stored access token
      expect(stamper.bearerToken).toBe("Bearer stored-access-token");
    });

    it("shares the in-flight refresh result and does not make a second request when already refreshing", async () => {
      const mockFetch = globalThis.fetch as jest.Mock;
      let resolveRefresh!: () => void;
      mockFetch.mockReturnValueOnce(
        new Promise(resolve => {
          resolveRefresh = () =>
            resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  access_token: "new",
                  refresh_token: "new-r",
                  token_type: "Bearer",
                  expires_in: 3600,
                }),
            });
        }),
      );

      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage, {
        authApiBaseUrl: "https://auth.example.com",
        clientId: "c",
        redirectUri: "https://app.example.com/cb",
      });
      await stamper.init();
      (stamper as any)._refreshToken = "stored-refresh-token";
      (stamper as any)._tokenExpiresAt = Date.now() - 1000;

      // Start a refresh but don't await it yet
      const firstRefresh = stamper.maybeRefreshTokens();
      // Second call while first is in flight
      const secondRefresh = stamper.maybeRefreshTokens();

      resolveRefresh();
      const [firstResult, secondResult] = await Promise.all([firstRefresh, secondRefresh]);
      expect(firstResult).toBe(true);
      expect(secondResult).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns false when the token is not near expiry", async () => {
      const mockFetch = globalThis.fetch as jest.Mock;

      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage, {
        authApiBaseUrl: "https://auth.example.com",
        clientId: "c",
        redirectUri: "https://app.example.com/cb",
      });
      await stamper.init();

      (stamper as any)._tokenExpiresAt = Date.now() + 3_600_000;
      (stamper as any)._refreshToken = "stored-refresh-token";

      const result = await stamper.maybeRefreshTokens();

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("token refresh", () => {
    it("triggers a background refresh when the token is near expiry", async () => {
      const mockFetch = globalThis.fetch as jest.Mock;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-access",
            refresh_token: "new-refresh",
            token_type: "Bearer",
            expires_in: 3600,
          }),
      });

      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage, {
        authApiBaseUrl: "https://auth.example.com",
        clientId: "client-1",
        redirectUri: "https://app.example.com/callback",
      });

      await stamper.init();

      // Force the token to be near expiry.
      (stamper as any)._tokenExpiresAt = Date.now() - 1000;
      (stamper as any)._refreshToken = "stored-refresh-token";

      // Access bearerToken to fire the background refresh.
      stamper.bearerToken;

      // Flush microtasks so the background refresh completes.
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockFetch).toHaveBeenCalledWith(
        "https://auth.example.com/oauth2/token",
        expect.objectContaining({ method: "POST" }),
      );
      expect(stamper.bearerToken).toBe("Bearer new-access");
    });

    it("does not refresh when no refreshConfig is provided", async () => {
      const mockFetch = globalThis.fetch as jest.Mock;

      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage);

      await stamper.init();

      (stamper as any)._tokenExpiresAt = Date.now() - 1000;

      // Access bearerToken to fire the background refresh.
      stamper.bearerToken;

      // Flush microtasks so the background refresh completes.
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not fire a second refresh while one is already in flight", async () => {
      const mockFetch = globalThis.fetch as jest.Mock;
      // Slow refresh that we can control.
      let resolveRefresh!: () => void;
      mockFetch.mockReturnValueOnce(
        new Promise(resolve => {
          resolveRefresh = () =>
            resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  access_token: "new",
                  refresh_token: "new-r",
                  token_type: "Bearer",
                  expires_in: 3600,
                }),
            });
        }),
      );

      const storage = makeStorage(STORED_RECORD);
      const stamper = new Auth2Stamper(storage, {
        authApiBaseUrl: "https://auth.example.com",
        clientId: "c",
        redirectUri: "https://app.example.com/cb",
      });

      await stamper.init();

      (stamper as any)._tokenExpiresAt = Date.now() - 1000;
      (stamper as any)._refreshToken = "r";

      // Trigger two concurrent getter accesses.
      stamper.bearerToken;
      stamper.bearerToken;

      resolveRefresh();
      await new Promise(resolve => setTimeout(resolve, 0));

      // fetch should only have been called once despite two accesses.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
