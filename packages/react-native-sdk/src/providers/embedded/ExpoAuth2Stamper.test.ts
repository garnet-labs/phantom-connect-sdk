import * as SecureStore from "expo-secure-store";
import { Auth2Stamper } from "@phantom/auth2";
import { SecureStoreAuth2StamperStorage } from "./SecureStoreAuth2StamperStorage";

const MOCK_RAW_PUBLIC_KEY = new Uint8Array([0x04, ...Array(64).fill(0x11)]); // 65-byte P-256
const MOCK_PKCS8 = new Uint8Array(100).fill(0x22);
const MOCK_SIGNATURE = new Uint8Array(64).fill(0x33);
const MOCK_DIGEST = new Uint8Array(32).fill(0x44);

const mockPrivateKey = { type: "private", algorithm: { name: "ECDSA" } } as CryptoKey;
const mockPublicKey = { type: "public", algorithm: { name: "ECDSA" } } as CryptoKey;
const mockKeyPair: CryptoKeyPair = { privateKey: mockPrivateKey, publicKey: mockPublicKey };

const mockSubtle = {
  generateKey: jest.fn().mockResolvedValue(mockKeyPair),
  exportKey: jest.fn((format: string) => {
    if (format === "raw") return Promise.resolve(MOCK_RAW_PUBLIC_KEY.buffer.slice(0) as ArrayBuffer);
    if (format === "pkcs8") return Promise.resolve(MOCK_PKCS8.buffer.slice(0) as ArrayBuffer);
    return Promise.resolve(new ArrayBuffer(0));
  }),
  sign: jest.fn().mockResolvedValue(MOCK_SIGNATURE.buffer.slice(0) as ArrayBuffer),
  digest: jest.fn().mockResolvedValue(MOCK_DIGEST.buffer.slice(0) as ArrayBuffer),
  importKey: jest.fn().mockResolvedValue(mockPrivateKey),
};

jest.mock("@phantom/base64url", () => ({
  base64urlEncode: jest.fn((data: Uint8Array) => Buffer.from(data).toString("base64url")),
}));

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ aud: [], ...payload })}.sig`;
}

function makeA2tJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  return makeJwt({ exp: now + 3600, iat: now });
}

const DEFAULT_ACCESS_TOKEN = makeJwt({ sub: "default-user", ext: { a2t: makeA2tJwt() } });

beforeEach(() => {
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: mockSubtle,
    writable: true,
    configurable: true,
  });
  mockSubtle.generateKey.mockResolvedValue(mockKeyPair);
  mockSubtle.exportKey.mockImplementation((format: string) => {
    if (format === "raw") return Promise.resolve(MOCK_RAW_PUBLIC_KEY.buffer.slice(0) as ArrayBuffer);
    if (format === "pkcs8") return Promise.resolve(MOCK_PKCS8.buffer.slice(0) as ArrayBuffer);
    return Promise.resolve(new ArrayBuffer(0));
  });
  mockSubtle.sign.mockResolvedValue(MOCK_SIGNATURE.buffer.slice(0) as ArrayBuffer);
  mockSubtle.digest.mockResolvedValue(MOCK_DIGEST.buffer.slice(0) as ArrayBuffer);
  mockSubtle.importKey.mockResolvedValue(mockPrivateKey);
  jest.clearAllMocks();
});

function makeStamper(storageKey = `phantom-auth2-test-${Math.random()}`) {
  return new Auth2Stamper(new SecureStoreAuth2StamperStorage(storageKey));
}

// Pre-computed: bs58.encode(MOCK_RAW_PUBLIC_KEY) where MOCK_RAW_PUBLIC_KEY = [0x04, 0x11 × 64]
const STORED_PUBLIC_KEY_BASE58 =
  "MpEALt31ZMzbaFHHt4TUTZ8eT3vovb7Bv3SpZUWhCDGHnND2aSxmeXF6CeWagvBG3MEYvvzWiJrfm7oy15DupRex";

function storedRecord(extras: object = {}, pkcs8Base64 = Buffer.from(MOCK_PKCS8).toString("base64")) {
  return JSON.stringify({
    privateKeyPkcs8: pkcs8Base64,
    keyInfo: {
      keyId: "stored-key-id",
      publicKey: STORED_PUBLIC_KEY_BASE58,
      createdAt: 1_000_000,
    },
    ...extras,
  });
}

describe("Auth2Stamper (SecureStore)", () => {
  describe("getKeyInfo()", () => {
    it("returns null before init()", () => {
      expect(makeStamper().getKeyInfo()).toBeNull();
    });

    it("returns keyInfo after init()", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null); // empty store

      const stamper = makeStamper();
      await stamper.init();

      expect(stamper.getKeyInfo()).not.toBeNull();
    });
  });

  describe("init()", () => {
    it("generates a new P-256 key pair when SecureStore is empty", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      await stamper.init();

      expect(mockSubtle.generateKey).toHaveBeenCalledWith(
        { name: "ECDSA", namedCurve: "P-256" },
        true, // extractable so PKCS8 can be exported
        ["sign", "verify"],
      );
    });

    it("exports PKCS#8 private key and persists to SecureStore", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      const storageKey = "phantom-auth2-app-1";
      const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage(storageKey));

      await stamper.init();

      expect(mockSubtle.exportKey).toHaveBeenCalledWith("pkcs8", mockPrivateKey);
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        storageKey,
        expect.stringContaining("privateKeyPkcs8"),
        expect.objectContaining({ requireAuthentication: false }),
      );
    });

    it("loads an existing key from SecureStore without generating a new one", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(storedRecord());

      const stamper = makeStamper();
      const keyInfo = await stamper.init();

      expect(mockSubtle.generateKey).not.toHaveBeenCalled();
      expect(keyInfo.keyId).toBe("stored-key-id");
      expect(keyInfo.publicKey).toBe(STORED_PUBLIC_KEY_BASE58);
    });

    it("imports the stored PKCS#8 key as extractable so save() can re-export it", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(storedRecord());

      const stamper = makeStamper();
      await stamper.init();

      expect(mockSubtle.importKey).toHaveBeenCalledWith(
        "pkcs8",
        // Buffer (from the "buffer" npm package) has the same byteLength as the original PKCS#8 data.
        // Using objectContaining avoids cross-realm instanceof issues between Buffer and Uint8Array.
        expect.objectContaining({ byteLength: MOCK_PKCS8.byteLength }),
        { name: "ECDSA", namedCurve: "P-256" },
        true, // extractable so save() can re-export via pkcs8
        ["sign"],
      );
    });

    it("throws when SecureStore returns invalid JSON (corrupt stored record)", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("not-valid-json");

      const stamper = makeStamper();
      await expect(stamper.init()).rejects.toThrow(/corrupt stored record/);
    });

    it("throws when SecureStore.getItemAsync itself throws", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("Keychain error"));

      const stamper = makeStamper();
      await expect(stamper.init()).rejects.toThrow("Keychain error");
    });

    it("keyInfo.keyId is the first 16 chars of base64url(SHA-256(rawPublicKey))", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      const keyInfo = await stamper.init();

      const expected = Buffer.from(MOCK_DIGEST).toString("base64url").substring(0, 16);
      expect(keyInfo.keyId).toBe(expected);
    });

    it("restores the access token from SecureStore on init()", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        storedRecord({ accessToken: DEFAULT_ACCESS_TOKEN, idType: "Bearer" }),
      );

      const stamper = makeStamper();
      await stamper.init();

      // stamp() should succeed without any additional setTokens call because
      // parseClaims() extracts auth2Token from the restored accessToken.
      await expect(stamper.stamp({ type: "OIDC", data: Buffer.from("payload") })).resolves.toBeTruthy();
    });
  });

  describe("setTokens()", () => {
    it("makes stamp() succeed after being called", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      await stamper.init();

      // setTokens reads the existing record to merge — return it
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(storedRecord());
      await stamper.setTokens({ accessToken: DEFAULT_ACCESS_TOKEN, idType: "Bearer" });

      await expect(stamper.stamp({ type: "OIDC", data: Buffer.from("payload") })).resolves.toBeTruthy();
    });

    it("persists accessToken, idType, and refreshToken to SecureStore", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      const storageKey = "phantom-auth2-persist-test";
      const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage(storageKey));
      await stamper.init();

      const tokenX = makeJwt({ sub: "u", ext: { a2t: makeA2tJwt() } });
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(storedRecord());
      await stamper.setTokens({ accessToken: tokenX, idType: "Bearer", refreshToken: "refresh-x" });

      const lastSaveCall = (SecureStore.setItemAsync as jest.Mock).mock.calls.at(-1) as [string, string];
      const saved = JSON.parse(lastSaveCall[1]) as { accessToken?: string; idType?: string; refreshToken?: string };
      expect(saved.accessToken).toBe(tokenX);
      expect(saved.idType).toBe("Bearer");
      expect(saved.refreshToken).toBe("refresh-x");
    });

    it("restores auth2Token in stamp output after a reload", async () => {
      // auth2Token is derived from the accessToken via parseClaims → jwtDecode (ext.a2t claim)
      const reloadA2tJwt = makeA2tJwt();
      const reloadAccessToken = makeJwt({ sub: "u", ext: { a2t: reloadA2tJwt } });
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
        storedRecord({ accessToken: reloadAccessToken, idType: "Bearer" }),
      );

      const stamper = makeStamper();
      await stamper.init();

      const stampStr = await stamper.stamp({ type: "OIDC", data: Buffer.from("payload") });
      const decoded = JSON.parse(Buffer.from(stampStr, "base64url").toString()) as {
        idToken: string;
      };
      expect(decoded.idToken).toBe(reloadA2tJwt);
    });
  });

  describe("stamp()", () => {
    it("throws if called before init()", async () => {
      const stamper = makeStamper();

      await expect(stamper.stamp({ type: "OIDC", data: Buffer.from("x") })).rejects.toThrow("not initialized");
    });

    it("signs with ECDSA P-256 / SHA-256", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      await stamper.init();
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(storedRecord());
      await stamper.setTokens({ accessToken: DEFAULT_ACCESS_TOKEN, idType: "Bearer" });

      await stamper.stamp({ type: "OIDC", data: Buffer.from("payload") });

      expect(mockSubtle.sign).toHaveBeenCalledWith(
        { name: "ECDSA", hash: "SHA-256" },
        mockPrivateKey,
        expect.any(Uint8Array),
      );
    });

    it("throws when called before setTokens()", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      await stamper.init();

      await expect(stamper.stamp({ type: "OIDC", data: Buffer.from("msg") })).rejects.toThrow("not initialized");
    });

    it("returns an OIDC stamp with the auth2Token extracted from the access token", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      await stamper.init();

      const rnA2tJwt = makeA2tJwt();
      const rnAccessToken = makeJwt({ sub: "u", ext: { a2t: rnA2tJwt } });
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(storedRecord());
      await stamper.setTokens({ accessToken: rnAccessToken, idType: "Bearer" });

      const stampStr = await stamper.stamp({ type: "OIDC", data: Buffer.from("payload") });
      const decoded = JSON.parse(Buffer.from(stampStr, "base64url").toString()) as {
        kind: string;
        idToken: string;
        publicKey: string;
        algorithm: string;
        salt: string;
        signature: string;
      };

      expect(decoded.kind).toBe("OIDC");
      expect(decoded.idToken).toBe(rnA2tJwt);
      expect(decoded.algorithm).toBe("Secp256r1");
      expect(decoded.salt).toBe("");
      expect(typeof decoded.publicKey).toBe("string");
      expect(typeof decoded.signature).toBe("string");
    });

    it("public key in stamp is base64url of the raw P-256 bytes", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      await stamper.init();
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(storedRecord());
      await stamper.setTokens({ accessToken: DEFAULT_ACCESS_TOKEN, idType: "Bearer" });

      const stampStr = await stamper.stamp({ type: "OIDC", data: Buffer.from("x") });
      const decoded = JSON.parse(Buffer.from(stampStr, "base64url").toString()) as { publicKey: string };
      expect(decoded.publicKey).toBe(Buffer.from(MOCK_RAW_PUBLIC_KEY).toString("base64url"));
    });
  });

  describe("resetKeyPair()", () => {
    it("generates a fresh key pair, replacing the stored one", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      await stamper.init();

      // Second generateKey call returns a distinct key.
      const newPublic = new Uint8Array([0x04, ...Array(64).fill(0x55)]);
      mockSubtle.exportKey.mockImplementationOnce(() => Promise.resolve(newPublic.buffer.slice(0) as ArrayBuffer));
      mockSubtle.exportKey.mockImplementationOnce(() => Promise.resolve(MOCK_PKCS8.buffer.slice(0) as ArrayBuffer));

      const newInfo = await stamper.resetKeyPair();

      expect(mockSubtle.generateKey).toHaveBeenCalledTimes(2);
      expect(newInfo).toBeTruthy();
    });

    it("deletes the old record from SecureStore before generating", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
      const storageKey = "reset-key";

      const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage(storageKey));
      await stamper.init();
      await stamper.resetKeyPair();

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(storageKey);
    });

    it("clears the auth2Token so stamp() throws after reset", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      await stamper.init();
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(storedRecord());
      await stamper.setTokens({ accessToken: DEFAULT_ACCESS_TOKEN, idType: "Bearer" });

      await stamper.resetKeyPair();

      await expect(stamper.stamp({ type: "OIDC", data: Buffer.from("x") })).rejects.toThrow("not initialized");
    });
  });

  describe("clear()", () => {
    it("nulls in-memory state", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      await stamper.init();
      await stamper.clear();

      expect(stamper.getKeyInfo()).toBeNull();
    });

    it("calls deleteItemAsync on SecureStore", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const storageKey = "clear-key";
      const stamper = new Auth2Stamper(new SecureStoreAuth2StamperStorage(storageKey));
      await stamper.init();
      await stamper.clear();

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(storageKey);
    });

    it("does not throw when SecureStore.deleteItemAsync fails", async () => {
      (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValueOnce(new Error("not found"));

      const stamper = makeStamper();

      await expect(stamper.clear()).resolves.toBeUndefined();
    });

    it("stamp() throws after clear()", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      await stamper.init();
      await stamper.clear();

      await expect(stamper.stamp({ type: "OIDC", data: Buffer.from("x") })).rejects.toThrow("not initialized");
    });
  });

  describe("rotateKeyPair()", () => {
    it("throws because Auth2 does not use key rotation", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);

      const stamper = makeStamper();
      await stamper.init();

      await expect(stamper.rotateKeyPair()).rejects.toThrow("not supported");
    });
  });

  describe("commitRotation()", () => {
    it("throws because Auth2 does not use key rotation", async () => {
      const stamper = makeStamper();

      await expect(stamper.commitRotation("any")).rejects.toThrow("not supported");
    });
  });

  describe("rollbackRotation()", () => {
    it("throws because Auth2 does not use key rotation", async () => {
      await expect(makeStamper().rollbackRotation()).rejects.toThrow("not supported");
    });
  });
});
