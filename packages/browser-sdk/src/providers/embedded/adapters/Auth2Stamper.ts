import bs58 from "bs58";
import { base64urlEncode } from "@phantom/base64url";
import { Algorithm } from "@phantom/sdk-types";
import type { StamperWithKeyManagement, StamperKeyInfo } from "@phantom/sdk-types";
import type { Buffer } from "buffer";

const STORE_NAME = "crypto-keys";
const ACTIVE_KEY = "auth2-p256-signing-key";

export class Auth2Stamper implements StamperWithKeyManagement {
  private db: IDBDatabase | null = null;
  private keyPair: CryptoKeyPair | null = null;
  private _keyInfo: StamperKeyInfo | null = null;

  readonly algorithm: Algorithm = Algorithm.secp256r1;
  type: "PKI" | "OIDC" = "PKI";
  idToken?: string;
  salt?: string;

  /**
   * @param dbName - IndexedDB database name (use a unique name per app to
   *   avoid key collisions with other stampers, e.g. `phantom-auth2-<appId>`).
   */
  constructor(private readonly dbName: string) {}

  async init(): Promise<StamperKeyInfo> {
    await this.openDB();

    const stored = await this.loadKeyPair();
    if (stored) {
      this.keyPair = stored.keyPair;
      this._keyInfo = stored.keyInfo;
      return this._keyInfo;
    }

    return this.generateAndStore();
  }

  getKeyInfo(): StamperKeyInfo | null {
    return this._keyInfo;
  }

  getCryptoKeyPair(): CryptoKeyPair | null {
    return this.keyPair;
  }

  async stamp(
    params:
      | { data: Buffer; type?: "PKI"; idToken?: never; salt?: never }
      | { data: Buffer; type: "OIDC"; idToken: string; salt: string },
  ): Promise<string> {
    if (!this.keyPair || !this._keyInfo) {
      throw new Error("Auth2Stamper not initialized. Call init() first.");
    }

    const signatureRaw = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this.keyPair.privateKey,
      new Uint8Array(params.data) as BufferSource,
    );

    const rawPublicKey = bs58.decode(this._keyInfo.publicKey);

    if (this.idToken === undefined || this.salt === undefined) {
      throw new Error("Auth2Stamper not initialized with idToken or salt.");
    }

    const stampData = {
      kind: "OIDC" as const,
      idToken: this.idToken,
      publicKey: base64urlEncode(rawPublicKey),
      algorithm: "Secp256r1" as const,
      salt: this.salt,
      signature: base64urlEncode(new Uint8Array(signatureRaw)),
    };

    return base64urlEncode(new TextEncoder().encode(JSON.stringify(stampData)));
  }

  async resetKeyPair(): Promise<StamperKeyInfo> {
    await this.clearStoredKey();
    this.keyPair = null;
    this._keyInfo = null;
    return this.generateAndStore();
  }

  async clear(): Promise<void> {
    await this.clearStoredKey();
    this.keyPair = null;
    this._keyInfo = null;
  }

  // Auth2 doesn't use key rotation; provide minimal no-op implementations.
  async rotateKeyPair(): Promise<StamperKeyInfo> {
    return this.init();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async commitRotation(authenticatorId: string): Promise<void> {
    if (this._keyInfo) {
      this._keyInfo.authenticatorId = authenticatorId;
    }
  }

  async rollbackRotation(): Promise<void> {}

  private async generateAndStore(): Promise<StamperKeyInfo> {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false, // non-extractable — private key never leaves Web Crypto
      ["sign", "verify"],
    );

    // Raw export of P-256 public key = 65-byte uncompressed point (0x04 || x || y).
    const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));

    // Store public key as base58 so deriveNonce(base58PubKey) works unchanged:
    //   nonce = base64url(SHA-256(bs58.decode(publicKey))) = base64url(SHA-256(rawP256Bytes))
    const publicKeyBase58 = bs58.encode(rawPublicKey);

    const keyIdBuffer = await crypto.subtle.digest("SHA-256", rawPublicKey.buffer as ArrayBuffer);
    const keyId = base64urlEncode(new Uint8Array(keyIdBuffer)).substring(0, 16);

    this.keyPair = keyPair;
    this._keyInfo = {
      keyId,
      publicKey: publicKeyBase58,
      createdAt: Date.now(),
    };

    await this.storeKeyPair(keyPair, this._keyInfo);
    return this._keyInfo;
  }

  private async openDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onerror = () => reject(request.error);

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }

  private async loadKeyPair(): Promise<{ keyPair: CryptoKeyPair; keyInfo: StamperKeyInfo } | null> {
    return new Promise<{ keyPair: CryptoKeyPair; keyInfo: StamperKeyInfo } | null>((resolve, reject): void => {
      if (!this.db) {
        throw new Error("Database not initialized");
      }

      const request = this.db.transaction([STORE_NAME], "readonly").objectStore(STORE_NAME).get(ACTIVE_KEY);

      request.onsuccess = (): void => {
        resolve(request.result ?? null);
      };
      request.onerror = (): void => {
        reject(request.error);
      };
    });
  }

  private async storeKeyPair(keyPair: CryptoKeyPair, keyInfo: StamperKeyInfo): Promise<void> {
    return new Promise<void>((resolve, reject): void => {
      if (!this.db) {
        throw new Error("Database not initialized");
      }

      const request = this.db
        .transaction([STORE_NAME], "readwrite")
        .objectStore(STORE_NAME)
        .put({ keyPair, keyInfo }, ACTIVE_KEY);
      request.onsuccess = (): void => {
        resolve();
      };
      request.onerror = (): void => {
        reject(request.error);
      };
    });
  }

  private async clearStoredKey(): Promise<void> {
    return new Promise<void>((resolve, reject): void => {
      if (!this.db) {
        throw new Error("Database not initialized");
      }

      const request = this.db.transaction([STORE_NAME], "readwrite").objectStore(STORE_NAME).delete(ACTIVE_KEY);
      request.onsuccess = (): void => {
        resolve();
      };
      request.onerror = (): void => {
        reject(request.error);
      };
    });
  }
}
