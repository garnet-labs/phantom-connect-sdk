import type { StamperKeyInfo } from "@phantom/sdk-types";

export interface Auth2StamperStoredRecord {
  keyPair: CryptoKeyPair;
  keyInfo: StamperKeyInfo;
  idType?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
}

/**
 * Platform-agnostic persistence layer for the Auth2 stamper's key pair and tokens.
 *
 * Implementations handle serialization details internally — for example, IndexedDB
 * can store non-extractable CryptoKeyPairs directly, while SecureStore must export
 * the private key to PKCS#8 and reimport it on load.
 */
export interface Auth2StamperStorage {
  /** One-time setup (e.g. opening an IndexedDB database). Optional. */
  open?(): Promise<void>;

  /** Load the persisted record, restoring a usable CryptoKeyPair. Returns null when empty. */
  load(): Promise<Auth2StamperStoredRecord | null>;

  /** Persist the record. */
  save(record: Auth2StamperStoredRecord): Promise<void>;

  /** Delete all persisted data. */
  clear(): Promise<void>;

  /**
   * Whether key generation must use `extractable: true`.
   *
   * SecureStore requires extractable keys so the private key can be exported to
   * PKCS#8 for string-based storage. IndexedDB can store non-extractable
   * CryptoKeyPairs directly, preserving the stronger security guarantee.
   */
  readonly requiresExtractableKeys: boolean;
}
