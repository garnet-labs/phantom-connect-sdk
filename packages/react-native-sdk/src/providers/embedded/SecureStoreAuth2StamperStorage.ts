import * as SecureStore from "expo-secure-store";
import bs58 from "bs58";
import { Buffer } from "buffer";
import type { Auth2StamperStorage, Auth2StamperStoredRecord } from "@phantom/auth2";
import type { StamperKeyInfo } from "@phantom/sdk-types";

interface SerializedKeyRecord {
  privateKeyPkcs8: string;
  keyInfo: StamperKeyInfo;
  idType?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
}

/**
 * Expo SecureStore-backed storage for Auth2Stamper.
 *
 * SecureStore only supports string values, so the P-256 private key is
 * exported as PKCS#8 base64 for persistence and reimported on load.
 */
export class SecureStoreAuth2StamperStorage implements Auth2StamperStorage {
  readonly requiresExtractableKeys = true;

  constructor(private readonly storageKey: string) {}

  async load(): Promise<Auth2StamperStoredRecord | null> {
    const raw = await SecureStore.getItemAsync(this.storageKey);
    if (raw === null) {
      return null;
    }

    let record: SerializedKeyRecord;

    try {
      record = JSON.parse(raw) as SerializedKeyRecord;
    } catch (err) {
      await SecureStore.deleteItemAsync(this.storageKey);
      throw new Error(`SecureStoreAuth2StamperStorage: corrupt stored record (JSON parse failed): ${err}`);
    }

    let privateKey: CryptoKey;
    let publicKey: CryptoKey;
    try {
      privateKey = await this.importPrivateKey(record.privateKeyPkcs8);
      publicKey = await this.importPublicKeyFromBase58(record.keyInfo.publicKey);
    } catch (err) {
      await SecureStore.deleteItemAsync(this.storageKey);
      throw new Error(`SecureStoreAuth2StamperStorage: corrupt stored record (key import failed): ${err}`);
    }

    return {
      keyPair: { privateKey, publicKey },
      keyInfo: record.keyInfo,
      accessToken: record.accessToken,
      idType: record.idType,
      refreshToken: record.refreshToken,
      tokenExpiresAt: record.tokenExpiresAt,
    };
  }

  async save(record: Auth2StamperStoredRecord): Promise<void> {
    const pkcs8Buffer = await crypto.subtle.exportKey("pkcs8", record.keyPair.privateKey);
    const privateKeyPkcs8 = Buffer.from(pkcs8Buffer).toString("base64");

    const serialized: SerializedKeyRecord = {
      privateKeyPkcs8,
      keyInfo: record.keyInfo,
      accessToken: record.accessToken,
      idType: record.idType,
      refreshToken: record.refreshToken,
      tokenExpiresAt: record.tokenExpiresAt,
    };

    await SecureStore.setItemAsync(this.storageKey, JSON.stringify(serialized), {
      requireAuthentication: false,
    });
  }

  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(this.storageKey);
    } catch {
      // Key might not exist; safe to ignore.
    }
  }

  private async importPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
    const pkcs8Bytes = Buffer.from(pkcs8Base64, "base64");
    return crypto.subtle.importKey(
      "pkcs8",
      pkcs8Bytes,
      { name: "ECDSA", namedCurve: "P-256" },
      this.requiresExtractableKeys, // extractable so save() can re-export via pkcs8
      ["sign"],
    );
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
}
