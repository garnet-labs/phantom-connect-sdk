import bs58 from "bs58";
import { base64urlEncode } from "@phantom/base64url";
import { Algorithm } from "@phantom/sdk-types";
import type { StamperKeyInfo } from "@phantom/sdk-types";
import { Auth2Token } from "./Auth2Token";
import type { Buffer } from "buffer";
import { refreshToken as refreshTokenRequest } from "./tokenExchange";
import type { Auth2StamperWithKeyManagement } from "./types";
import type { Auth2StamperStorage } from "./Auth2StamperStorage";

/** Refresh the access token when fewer than this many ms remain before expiry. */
const TOKEN_REFRESH_BUFFER_MS = 15 * 60 * 1000;

export type Auth2StamperRefreshConfig = {
  authApiBaseUrl: string;
  clientId: string;
  redirectUri: string;
};

export class Auth2Stamper implements Auth2StamperWithKeyManagement {
  private _keyPair: CryptoKeyPair | null = null;
  private _keyInfo: StamperKeyInfo | null = null;
  private _idType: string | null = null;
  private _accessToken: string | null = null;
  private _refreshToken: string | null = null;
  private _tokenExpiresAt: number | null = null;

  private refreshingTokensPromise: Promise<boolean> | null = null;

  // Because TOKEN_REFRESH_BUFFER_MS proactively handles refresh, we can safely use void here
  // and return the existing cached values immediately.
  get bearerToken(): string | null {
    if (!this._idType || !this._accessToken) {
      return null;
    }
    void this.maybeRefreshTokens();
    return `${this._idType} ${this._accessToken}`;
  }

  get auth2Token(): Auth2Token | null {
    if (!this._accessToken) {
      return null;
    }
    void this.maybeRefreshTokens();
    return Auth2Token.fromAccessToken(this._accessToken);
  }

  readonly algorithm: Algorithm = Algorithm.secp256r1;
  readonly type = "OIDC";

  constructor(
    private readonly storage: Auth2StamperStorage,
    private readonly refreshConfig?: Auth2StamperRefreshConfig,
  ) {}

  async init(): Promise<StamperKeyInfo> {
    if (this.storage.open) {
      await this.storage.open();
    }

    const stored = await this.storage.load();
    if (stored) {
      this._keyPair = stored.keyPair;
      this._keyInfo = stored.keyInfo;
      if (stored.idType) {
        this._idType = stored.idType;
      }
      if (stored.accessToken) {
        this._accessToken = stored.accessToken;
      }
      if (stored.refreshToken) {
        this._refreshToken = stored.refreshToken;
      }
      if (stored.tokenExpiresAt) {
        this._tokenExpiresAt = stored.tokenExpiresAt;
      }
      return this._keyInfo;
    }

    return this.generateAndStore();
  }

  getKeyInfo(): StamperKeyInfo | null {
    return this._keyInfo;
  }

  getCryptoKeyPair(): CryptoKeyPair | null {
    return this._keyPair;
  }

  /**
   * Arms the stamper with the access token data for subsequent KMS stamp() calls.
   *
   * Persists the tokens alongside the key pair so that auto-connect can
   * restore them on the next launch without a new login.
   */
  async setTokens({
    accessToken,
    idType,
    refreshToken,
    expiresInMs,
  }: {
    accessToken: string;
    idType: string;
    refreshToken?: string;
    expiresInMs?: number;
  }): Promise<void> {
    this._idType = idType;
    this._accessToken = accessToken;
    this._refreshToken = refreshToken ?? null;
    this._tokenExpiresAt = expiresInMs != null ? Date.now() + expiresInMs : null;

    const existing = await this.storage.load();
    if (existing) {
      await this.storage.save({
        ...existing,
        accessToken,
        idType,
        refreshToken,
        tokenExpiresAt: this._tokenExpiresAt ?? undefined,
      });
    }
  }

  /**
   * Checks if tokens should be refreshed and performs a refresh if needed.
   * Returns true if a refresh succeeded, false otherwise.
   */
  async maybeRefreshTokens(): Promise<boolean> {
    if (this.refreshingTokensPromise) {
      return this.refreshingTokensPromise;
    }

    if (
      !this.refreshConfig ||
      !this._refreshToken ||
      !this._tokenExpiresAt ||
      Date.now() < this._tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
    ) {
      return false;
    }

    const refreshConfig = this.refreshConfig;
    const refreshToken = this._refreshToken;

    this.refreshingTokensPromise = (async () => {
      try {
        const refreshed = await refreshTokenRequest({
          authApiBaseUrl: refreshConfig.authApiBaseUrl,
          clientId: refreshConfig.clientId,
          redirectUri: refreshConfig.redirectUri,
          refreshToken,
        });

        await this.setTokens({
          accessToken: refreshed.accessToken,
          idType: refreshed.idType,
          refreshToken: refreshed.refreshToken,
          expiresInMs: refreshed.expiresInMs,
        });
        return true;
      } catch (error) {
        console.error("Failed to refresh tokens:", error);
        return false;
      } finally {
        this.refreshingTokensPromise = null;
      }
    })();

    return this.refreshingTokensPromise;
  }
  async stamp(params: { data: Buffer; type?: "PKI" } | { data: Buffer; type: "OIDC" }): Promise<string> {
    if (!this._keyPair || !this._keyInfo || !this.auth2Token) {
      throw new Error("Auth2Stamper not initialized. Call init() first.");
    }

    const signatureRaw = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this._keyPair.privateKey,
      new Uint8Array(params.data) as BufferSource,
    );

    const rawPublicKey = bs58.decode(this._keyInfo.publicKey);

    const stampData = {
      kind: this.type,
      idToken: this.auth2Token.a2t,
      publicKey: base64urlEncode(rawPublicKey),
      algorithm: this.algorithm,
      // The P-256 ephemeral key is unique per wallet, so no additional salt is needed.
      salt: "",
      signature: base64urlEncode(new Uint8Array(signatureRaw)),
    };

    return base64urlEncode(new TextEncoder().encode(JSON.stringify(stampData)));
  }

  async resetKeyPair(): Promise<StamperKeyInfo> {
    await this.clear();
    return this.generateAndStore();
  }

  async clear(): Promise<void> {
    await this.storage.clear();
    this._keyPair = null;
    this._keyInfo = null;
    this._accessToken = null;
    this._idType = null;
    this._refreshToken = null;
    this._tokenExpiresAt = null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async rotateKeyPair(): Promise<StamperKeyInfo> {
    throw new Error("rotateKeyPair is not supported for Auth2Stamper");
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async commitRotation(_authenticatorId: string): Promise<void> {
    throw new Error("commitRotation is not supported for Auth2Stamper");
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async rollbackRotation(): Promise<void> {
    throw new Error("rollbackRotation is not supported for Auth2Stamper");
  }

  private async generateAndStore(): Promise<StamperKeyInfo> {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      this.storage.requiresExtractableKeys,
      ["sign", "verify"],
    );

    // Raw export of P-256 public key = 65-byte uncompressed point (0x04 || x || y).
    const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));

    // Store public key as base58 so deriveNonce(base58PubKey) works unchanged:
    const publicKeyBase58 = bs58.encode(rawPublicKey);

    const keyIdBuffer = await crypto.subtle.digest("SHA-256", rawPublicKey.buffer as ArrayBuffer);
    const keyId = base64urlEncode(new Uint8Array(keyIdBuffer)).substring(0, 16);

    this._keyPair = keyPair;
    this._keyInfo = { keyId, publicKey: publicKeyBase58, createdAt: Date.now() };

    await this.storage.save({ keyPair, keyInfo: this._keyInfo });
    return this._keyInfo;
  }
}
