import type { Auth2StamperStorage, Auth2StamperStoredRecord } from "@phantom/auth2";

const STORE_NAME = "crypto-keys";
const ACTIVE_KEY = "auth2-p256-signing-key";

/**
 * IndexedDB-backed storage for Auth2Stamper.
 *
 * Stores CryptoKeyPair objects directly (non-extractable private keys never
 * leave Web Crypto), which provides a stronger security guarantee than
 * string-based storage.
 */
export class IndexedDBAuth2StamperStorage implements Auth2StamperStorage {
  private db: IDBDatabase | null = null;

  readonly requiresExtractableKeys = false;

  constructor(private readonly dbName: string) {}

  async open(): Promise<void> {
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

  async load(): Promise<Auth2StamperStoredRecord | null> {
    return new Promise<Auth2StamperStoredRecord | null>((resolve, reject): void => {
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

  async save(record: Auth2StamperStoredRecord): Promise<void> {
    return new Promise<void>((resolve, reject): void => {
      if (!this.db) {
        throw new Error("Database not initialized");
      }

      const request = this.db.transaction([STORE_NAME], "readwrite").objectStore(STORE_NAME).put(record, ACTIVE_KEY);
      request.onsuccess = (): void => {
        resolve();
      };
      request.onerror = (): void => {
        reject(request.error);
      };
    });
  }

  async clear(): Promise<void> {
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
