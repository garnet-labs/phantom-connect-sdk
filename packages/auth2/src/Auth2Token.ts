import { jwtDecode } from "jwt-decode";

type Claims = {
  sub: string;
  client_id: string;
  iss: string;
  exp: number;
  iat: number;
  aud: Array<string>;
  ext: {
    a2t: string;
  };
};

type A2TClaims = {
  exp: number;
  iat: number;
};

type WalletIdentity = {
  id: string;
  derivationIndex: number;
};

export class Auth2Token {
  private WALLET_URN_PREFIX = "urn:phantom:wallet:";
  private WALLET_TAG_URN_PREFIX = "urn:phantom:wallet-tag:";

  private _claims: Claims;
  private _a2tClaims: A2TClaims;

  private _identity?: WalletIdentity;
  private _walletTag?: string;

  private constructor(accessToken: string) {
    this._claims = decodeJwtClaims<Claims>(accessToken);
    this._a2tClaims = decodeJwtClaims<A2TClaims>(this._claims.ext.a2t);

    const walletAud = this._claims.aud.find(aud => aud.startsWith(this.WALLET_URN_PREFIX));
    if (walletAud) {
      const [id, derivationIndex] = walletAud.replace(this.WALLET_URN_PREFIX, "").split(":");
      this._identity = {
        id,
        derivationIndex: Number(derivationIndex),
      };
    }

    const walletTagAud = this._claims.aud.find(aud => aud.startsWith(this.WALLET_TAG_URN_PREFIX));
    if (walletTagAud) {
      this._walletTag = walletTagAud.replace(this.WALLET_TAG_URN_PREFIX, "");
    }
  }

  static fromAccessToken(accessToken: string): Auth2Token {
    return new this(accessToken);
  }

  get sub(): Claims["sub"] {
    return this._claims.sub;
  }

  get clientId(): Claims["client_id"] {
    return this._claims.client_id;
  }

  get wallet(): WalletIdentity | undefined {
    return this._identity;
  }

  get walletTag(): string | undefined {
    return this._walletTag;
  }

  get a2t(): Claims["ext"]["a2t"] {
    if (this._a2tClaims.exp < Date.now() / 1_000) {
      throw new Auth2TokenExpiredError();
    }
    return this._claims.ext.a2t;
  }
}

export function decodeJwtClaims<T>(jwt: string): T {
  return jwtDecode<T>(jwt);
}

export class Auth2TokenExpiredError extends Error {
  constructor() {
    super("Auth2 token expired");
    this.name = "Auth2TokenExpiredError";
  }
}
