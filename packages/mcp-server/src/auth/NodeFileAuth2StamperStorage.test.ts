import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { NodeFileAuth2StamperStorage } from "./NodeFileAuth2StamperStorage";

describe("NodeFileAuth2StamperStorage", () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "phantom-mcp-auth2-"));
  });

  afterEach(() => {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  });

  it("persists and reloads an auth2 stamper record", async () => {
    const storage = new NodeFileAuth2StamperStorage(sessionDir);
    const keyPair = (await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;

    await storage.save({
      keyPair,
      keyInfo: {
        keyId: "key-id-123",
        publicKey: "public-key-123",
        createdAt: 1234567890,
      },
      idType: "Bearer",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenExpiresAt: 999999999999,
    });

    const loaded = await storage.load();

    expect(loaded).not.toBeNull();
    expect(loaded!.keyInfo).toEqual({
      keyId: "key-id-123",
      publicKey: "public-key-123",
      createdAt: 1234567890,
    });
    expect(loaded!.accessToken).toBe("access-token");
    expect(loaded!.refreshToken).toBe("refresh-token");
    expect(loaded!.tokenExpiresAt).toBe(999999999999);
    expect(loaded!.keyPair.privateKey).toBeDefined();
    expect(loaded!.keyPair.publicKey).toBeDefined();
  });

  it("clears the stored auth2 record", async () => {
    const storage = new NodeFileAuth2StamperStorage(sessionDir);
    const keyPair = (await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;

    await storage.save({
      keyPair,
      keyInfo: {
        keyId: "key-id-123",
        publicKey: "public-key-123",
        createdAt: 1234567890,
      },
    });
    await storage.clear();

    await expect(storage.load()).resolves.toBeNull();
  });
});
