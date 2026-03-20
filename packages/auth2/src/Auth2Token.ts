import { jwtDecode } from "jwt-decode";

type Auth2TokenClaims = {
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

type WalletIdentity = {
  id: string;
  derivationIndex: number;
};

export class Auth2Token {
  private WALLET_URN_PREFIX = "urn:phantom:wallet:";

  private _claims: Auth2TokenClaims;
  private _identity?: WalletIdentity;

  private constructor(accessToken: string) {
    const claims = jwtDecode<Auth2TokenClaims>(accessToken);

    this._claims = claims;

    const aud = claims.aud.find(aud => aud.startsWith(this.WALLET_URN_PREFIX));

    if (!aud) {
      return;
    }

    const [id, derivationIndex] = aud.replace(this.WALLET_URN_PREFIX, "").split(":");
    this._identity = {
      id,
      derivationIndex: Number(derivationIndex),
    };
  }

  static fromAccessToken(accessToken: string): Auth2Token {
    return new this(accessToken);
  }

  get sub(): Auth2TokenClaims["sub"] {
    return this._claims.sub;
  }

  get clientId(): Auth2TokenClaims["client_id"] {
    return this._claims.client_id;
  }

  get a2t(): Auth2TokenClaims["ext"]["a2t"] {
    return this._claims.ext.a2t;
  }

  get wallet(): WalletIdentity | undefined {
    return this._identity;
  }
}
