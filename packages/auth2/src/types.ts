import type { StamperWithKeyManagement } from "@phantom/sdk-types";
import type { Auth2Token } from "./Auth2Token";

export interface Auth2StamperWithKeyManagement extends StamperWithKeyManagement {
  auth2Token: Auth2Token | null;
  bearerToken: string | null;
  getCryptoKeyPair(): CryptoKeyPair | null;
  setTokens(options: {
    accessToken: string;
    idType: string;
    refreshToken?: string;
    expiresInMs?: number;
  }): Promise<void>;
}

export type Auth2AuthProviderOptions = {
  /** OAuth2 client ID */
  clientId: string;
  /** Where the OAuth server redirects back after authentication. */
  redirectUri: string;
  /** The URL of the login page */
  connectLoginUrl: string;
  /** Base URL of the Auth2 server used for token exchange. */
  authApiBaseUrl: string;
};
