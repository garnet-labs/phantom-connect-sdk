import * as WebBrowser from "expo-web-browser";
import type { AuthProvider, AuthResult, PhantomConnectOptions } from "@phantom/embedded-provider-core";
import {
  Auth2KmsRpcClient,
  prepareAuth2Flow,
  validateAuth2Callback,
  completeAuth2Exchange,
  type Auth2AuthProviderOptions,
  type Auth2KmsClientOptions,
  type Auth2StamperWithKeyManagement,
} from "@phantom/auth2";

export class ExpoAuth2AuthProvider implements AuthProvider {
  private readonly auth2ProviderOptions: Auth2AuthProviderOptions;
  private readonly kms: Auth2KmsRpcClient;

  constructor(
    private readonly stamper: Auth2StamperWithKeyManagement,
    auth2ProviderOptions: Auth2AuthProviderOptions,
    kmsClientOptions: Auth2KmsClientOptions,
  ) {
    this.auth2ProviderOptions = auth2ProviderOptions;
    this.kms = new Auth2KmsRpcClient(stamper, kmsClientOptions);
  }

  /**
   * Runs the full PKCE Auth2 flow inline using expo-web-browser.
   *
   * Unlike the browser flow (which requires a page redirect and resumeAuthFromRedirect),
   * expo-web-browser intercepts the OAuth callback URL and returns it synchronously,
   * so the token exchange and KMS calls all happen here before returning AuthResult.
   */
  async authenticate(options: PhantomConnectOptions): Promise<void | AuthResult> {
    const { url, codeVerifier } = await prepareAuth2Flow({
      stamper: this.stamper,
      auth2Options: this.auth2ProviderOptions,
      sessionId: options.sessionId,
      provider: options.provider,
    });

    await WebBrowser.warmUpAsync();

    let result: Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>;
    try {
      result = await WebBrowser.openAuthSessionAsync(url, this.auth2ProviderOptions.redirectUri);
    } finally {
      await WebBrowser.coolDownAsync();
    }

    if (!result.url) {
      throw new Error("Authentication failed");
    }

    const callbackUrl = new URL(result.url);
    const code = validateAuth2Callback({
      getParam: key => callbackUrl.searchParams.get(key),
      expectedSessionId: options.sessionId,
    });

    return completeAuth2Exchange({
      stamper: this.stamper,
      kms: this.kms,
      auth2Options: this.auth2ProviderOptions,
      code,
      codeVerifier,
      provider: options.provider,
    });
  }
}
