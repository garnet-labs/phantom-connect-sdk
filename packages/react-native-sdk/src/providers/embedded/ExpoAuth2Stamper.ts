import * as SecureStore from "expo-secure-store";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { base64urlEncode } from "@phantom/base64url";
import { Algorithm } from "@phantom/sdk-types";
import type { StamperWithKeyManagement, StamperKeyInfo } from "@phantom/sdk-types";

interface StoredKeyRecord {
  privateKeyPkcs8: string;
  keyInfo: StamperKeyInfo;
}

export class ExpoAuth2Stamper implements StamperWithKeyManagement {
  private privateKey: CryptoKey | null = null;
  private publicKey: CryptoKey | null = null;
  private _keyInfo: StamperKeyInfo | null = null;

  readonly algorithm: Algorithm = Algorithm.secp256r1;
  type: "PKI" | "OIDC" = "OIDC";
  idToken?: string;
  salt?: string;

  /**
   * @param storageKey - expo-secure-store key used to persist the P-256 private key.
   *   Use a unique key per app, e.g. `phantom-auth2-<appId>`.
   */
  constructor(private readonly storageKey: string) {}

  async init(): Promise<StamperKeyInfo> {
    const stored = await this.loadRecord();
    if (stored) {
      this.privateKey = await this.importPrivateKey(stored.privateKeyPkcs8);
      this.publicKey = await this.importPublicKeyFromBase58(stored.keyInfo.publicKey);
      this._keyInfo = stored.keyInfo;
      return this._keyInfo;
    }

    return this.generateAndStore();
  }

  getKeyInfo(): StamperKeyInfo | null {
    return this._keyInfo;
  }

  getCryptoKeyPair(): CryptoKeyPair | null {
    if (!this.privateKey || !this.publicKey) return null;
    return { privateKey: this.privateKey, publicKey: this.publicKey };
  }

  async stamp(
    params:
      | { data: Buffer; type?: "PKI"; idToken?: never; salt?: never }
      | { data: Buffer; type: "OIDC"; idToken: string; salt: string },
  ): Promise<string> {
    if (!this.privateKey || !this._keyInfo) {
      throw new Error("ExpoAuth2Stamper not initialized. Call init() first.");
    }

    const signatureRaw = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this.privateKey,
      new Uint8Array(params.data) as BufferSource,
    );

    const rawPublicKey = bs58.decode(this._keyInfo.publicKey);

    if (this.idToken === undefined || this.salt === undefined) {
      throw new Error("ExpoAuth2Stamper not initialized with idToken or salt.");
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
    await this.clearStoredRecord();
    this.privateKey = null;
    this.publicKey = null;
    this._keyInfo = null;
    return this.generateAndStore();
  }

  async clear(): Promise<void> {
    await this.clearStoredRecord();
    this.privateKey = null;
    this.publicKey = null;
    this._keyInfo = null;
  }

  // Auth2 doesn't use key rotation; minimal no-op implementations.
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
      true, // extractable — needed to export PKCS#8 for SecureStore
      ["sign", "verify"],
    );

    // Raw export of P-256 public key = 65-byte uncompressed point (0x04 || x || y).
    const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));

    // Store public key as base58 so deriveNonce(base58PubKey) works unchanged:
    //   nonce = base64url(SHA-256(bs58.decode(publicKey))) = base64url(SHA-256(rawP256Bytes))
    const publicKeyBase58 = bs58.encode(rawPublicKey);

    const keyIdBuffer = await crypto.subtle.digest("SHA-256", rawPublicKey.buffer as ArrayBuffer);
    const keyId = base64urlEncode(new Uint8Array(keyIdBuffer)).substring(0, 16);

    this._keyInfo = { keyId, publicKey: publicKeyBase58, createdAt: Date.now() };

    // Export the private key as PKCS#8 for persistent storage.
    const pkcs8Buffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const privateKeyPkcs8 = Buffer.from(pkcs8Buffer).toString("base64");

    await SecureStore.setItemAsync(
      this.storageKey,
      JSON.stringify({ privateKeyPkcs8, keyInfo: this._keyInfo } satisfies StoredKeyRecord),
      { requireAuthentication: false },
    );

    // Hold both keys in memory for the session.
    this.privateKey = await this.importPrivateKey(privateKeyPkcs8);
    this.publicKey = keyPair.publicKey;

    return this._keyInfo;
  }

  private async importPublicKeyFromBase58(base58PublicKey: string): Promise<CryptoKey> {
    const rawBytes = bs58.decode(base58PublicKey);
    return crypto.subtle.importKey(
      "raw",
      rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength) as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      true, // extractable so createAuth2RequestJar can export it as JWK
      ["verify"],
    );
  }

  private async importPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
    const pkcs8Bytes = Buffer.from(pkcs8Base64, "base64");
    return crypto.subtle.importKey(
      "pkcs8",
      pkcs8Bytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false, // non-extractable once loaded into memory
      ["sign"],
    );
  }

  private async loadRecord(): Promise<StoredKeyRecord | null> {
    try {
      const raw = await SecureStore.getItemAsync(this.storageKey);
      return raw ? (JSON.parse(raw) as StoredKeyRecord) : null;
    } catch {
      return null;
    }
  }

  private async clearStoredRecord(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(this.storageKey);
    } catch {
      // Key might not exist; safe to ignore.
    }
  }
}
