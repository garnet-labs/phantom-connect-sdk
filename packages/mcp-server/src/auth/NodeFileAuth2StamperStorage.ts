import * as fs from "fs";
import * as path from "path";
import type { Auth2StamperStorage, Auth2StamperStoredRecord } from "@phantom/auth2";
import type { StamperKeyInfo } from "@phantom/sdk-types";

type PersistedAuth2Record = {
  keyInfo: StamperKeyInfo;
  publicKeyRawBase64: string;
  privateKeyPkcs8Base64: string;
  idType?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
};

/**
 * Filesystem-backed Auth2Stamper storage for Node/MCP.
 *
 * Unlike IndexedDB-backed browser storage, Node must serialize CryptoKeys, so
 * keys are persisted as PKCS#8 + raw public key and re-imported on load.
 */
export class NodeFileAuth2StamperStorage implements Auth2StamperStorage {
  readonly requiresExtractableKeys = true;
  private readonly storageFile: string;

  constructor(private readonly sessionDir: string) {
    this.storageFile = path.join(this.sessionDir, "auth2-stamper.json");
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async open(): Promise<void> {
    fs.mkdirSync(this.sessionDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.sessionDir, 0o700);
    } catch {
      // Ignore chmod errors on Windows.
    }
  }

  async load(): Promise<Auth2StamperStoredRecord | null> {
    if (!fs.existsSync(this.storageFile)) {
      return null;
    }

    const raw = fs.readFileSync(this.storageFile, "utf-8");
    const stored = JSON.parse(raw) as Partial<PersistedAuth2Record>;
    if (
      typeof stored.keyInfo?.publicKey !== "string" ||
      typeof stored.keyInfo?.keyId !== "string" ||
      typeof stored.keyInfo?.createdAt !== "number" ||
      typeof stored.publicKeyRawBase64 !== "string" ||
      typeof stored.privateKeyPkcs8Base64 !== "string"
    ) {
      return null;
    }

    const [publicKey, privateKey] = await Promise.all([
      globalThis.crypto.subtle.importKey(
        "raw",
        Buffer.from(stored.publicKeyRawBase64, "base64"),
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"],
      ),
      globalThis.crypto.subtle.importKey(
        "pkcs8",
        Buffer.from(stored.privateKeyPkcs8Base64, "base64"),
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"],
      ),
    ]);

    return {
      keyPair: { publicKey, privateKey },
      keyInfo: stored.keyInfo,
      idType: stored.idType,
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      tokenExpiresAt: stored.tokenExpiresAt,
    };
  }

  async save(record: Auth2StamperStoredRecord): Promise<void> {
    await this.open();

    const [publicKeyRaw, privateKeyPkcs8] = await Promise.all([
      globalThis.crypto.subtle.exportKey("raw", record.keyPair.publicKey),
      globalThis.crypto.subtle.exportKey("pkcs8", record.keyPair.privateKey),
    ]);

    const persisted: PersistedAuth2Record = {
      keyInfo: record.keyInfo,
      publicKeyRawBase64: Buffer.from(publicKeyRaw).toString("base64"),
      privateKeyPkcs8Base64: Buffer.from(privateKeyPkcs8).toString("base64"),
      idType: record.idType,
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      tokenExpiresAt: record.tokenExpiresAt,
    };

    fs.writeFileSync(this.storageFile, JSON.stringify(persisted, null, 2), { mode: 0o600 });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async clear(): Promise<void> {
    if (!fs.existsSync(this.storageFile)) {
      return;
    }
    fs.unlinkSync(this.storageFile);
  }
}
