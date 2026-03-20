import type {
  AuthProvider,
  AuthResult,
  EmbeddedStorage,
  PhantomConnectOptions,
  URLParamsAccessor,
  EmbeddedProviderAuthType,
} from "@phantom/embedded-provider-core";
import {
  Auth2KmsRpcClient,
  prepareAuth2Flow,
  validateAuth2Callback,
  completeAuth2Exchange,
  type Auth2AuthProviderOptions,
  type Auth2KmsClientOptions,
  type Auth2StamperWithKeyManagement,
} from "@phantom/auth2";

export class Auth2AuthProvider implements AuthProvider {
  private readonly auth2ProviderOptions: Auth2AuthProviderOptions;
  private readonly kms: Auth2KmsRpcClient;

  /** Redirect the browser. Extracted as a static method so tests can spy on it. */
  static navigate(url: string): void {
    window.location.href = url;
  }

  constructor(
    private readonly stamper: Auth2StamperWithKeyManagement,
    private readonly storage: EmbeddedStorage,
    private readonly urlParamsAccessor: URLParamsAccessor,
    auth2ProviderOptions: Auth2AuthProviderOptions,
    kmsClientOptions: Auth2KmsClientOptions,
  ) {
    this.auth2ProviderOptions = auth2ProviderOptions;
    this.kms = new Auth2KmsRpcClient(stamper, kmsClientOptions);
  }

  /**
   * Builds the Auth2 /login/start URL and redirects the browser.
   *
   * Called by EmbeddedProvider.handleRedirectAuth() after the stamper has
   * already been initialized and a pending Session has been saved to storage.
   * We store the PKCE code_verifier into that session so it survives the page
   * redirect without ever touching sessionStorage.
   */
  async authenticate(options: PhantomConnectOptions): Promise<void> {
    const session = await this.storage.getSession();
    if (!session) {
      throw new Error("Session not found.");
    }

    const { url, codeVerifier } = await prepareAuth2Flow({
      stamper: this.stamper,
      auth2Options: this.auth2ProviderOptions,
      sessionId: options.sessionId,
      provider: options.provider,
    });

    await this.storage.saveSession({ ...session, pkceCodeVerifier: codeVerifier });

    Auth2AuthProvider.navigate(url);
  }

  /**
   * Processes the Auth2 callback after the browser returns from /login/start.
   *
   * Exchanges the authorization code for tokens, discovers the organization
   * and wallet via KMS RPC, then returns a completed AuthResult.
   */
  async resumeAuthFromRedirect(provider: EmbeddedProviderAuthType): Promise<AuthResult | null> {
    if (!this.urlParamsAccessor.getParam("code")) {
      return null;
    }

    if (!this.stamper.getKeyInfo()) {
      await this.stamper.init();
    }

    const session = await this.storage.getSession();
    if (!session) {
      throw new Error("Session not found.");
    }

    const codeVerifier = session?.pkceCodeVerifier;
    if (!codeVerifier) {
      return null;
    }

    const code = validateAuth2Callback({
      getParam: key => this.urlParamsAccessor.getParam(key),
      expectedSessionId: session.sessionId,
    });

    const result = await completeAuth2Exchange({
      stamper: this.stamper,
      kms: this.kms,
      auth2Options: this.auth2ProviderOptions,
      code,
      codeVerifier,
      provider,
    });

    await this.storage.saveSession({
      ...session,
      status: "completed",
      bearerToken: result.bearerToken,
      authUserId: result.authUserId,
      pkceCodeVerifier: undefined,
    });

    return result;
  }
}
