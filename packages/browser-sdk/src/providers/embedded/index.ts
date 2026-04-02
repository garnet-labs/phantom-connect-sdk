import { EmbeddedProvider as CoreEmbeddedProvider } from "@phantom/embedded-provider-core";
import type { EmbeddedProviderConfig, PlatformAdapter } from "@phantom/embedded-provider-core";
import { Auth2Stamper } from "@phantom/auth2";
import {
  BrowserStorage,
  BrowserURLParamsAccessor,
  Auth2AuthProvider,
  IndexedDBAuth2StamperStorage,
  BrowserPhantomAppProvider,
  BrowserLogger,
} from "./adapters";
import { debug, DebugCategory } from "../../debug";
import { detectBrowser, getPlatformName } from "../../utils/browser-detection";
import type { Provider } from "../../types";
import { ANALYTICS_HEADERS, type SdkWalletType } from "@phantom/constants";
import type { AddressType } from "@phantom/client";

export class EmbeddedProvider extends CoreEmbeddedProvider implements Provider {
  private addressTypes: AddressType[];

  constructor(config: EmbeddedProviderConfig) {
    debug.log(DebugCategory.EMBEDDED_PROVIDER, "Initializing Browser EmbeddedProvider", { config });
    // Create browser platform adapter
    const urlParamsAccessor = new BrowserURLParamsAccessor();
    const storage = new BrowserStorage();

    const stamper = new Auth2Stamper(new IndexedDBAuth2StamperStorage(`phantom-auth2-${config.appId}`), {
      authApiBaseUrl: config.authOptions.authApiBaseUrl,
      clientId: config.appId,
      redirectUri: config.authOptions.redirectUrl,
    });

    const platformName = getPlatformName();
    const { name: browserName, version } = detectBrowser();

    const authProvider = new Auth2AuthProvider(
      stamper,
      storage,
      urlParamsAccessor,
      {
        redirectUri: config.authOptions.redirectUrl,
        connectLoginUrl: config.authOptions.authUrl,
        clientId: config.appId,
        authApiBaseUrl: config.authOptions.authApiBaseUrl,
      },
      {
        apiBaseUrl: config.apiBaseUrl,
        appId: config.appId,
      },
    );

    const platform: PlatformAdapter = {
      storage,
      authProvider,
      phantomAppProvider: new BrowserPhantomAppProvider(),
      urlParamsAccessor,
      stamper,
      name: platformName, // Use detected browser name and version for identification
      analyticsHeaders: {
        [ANALYTICS_HEADERS.SDK_TYPE]: "browser",
        [ANALYTICS_HEADERS.PLATFORM]: "ext-sdk",
        [ANALYTICS_HEADERS.PLATFORM_VERSION]: version,
        [ANALYTICS_HEADERS.CLIENT]: browserName,
        [ANALYTICS_HEADERS.APP_ID]: config.appId,
        [ANALYTICS_HEADERS.WALLET_TYPE]: config.embeddedWalletType as SdkWalletType,
        [ANALYTICS_HEADERS.SDK_VERSION]: __SDK_VERSION__, // Replaced at build time
      },
    };

    debug.log(DebugCategory.EMBEDDED_PROVIDER, "Detected platform", { platformName });

    const logger = new BrowserLogger();

    super(config, platform, logger);

    this.addressTypes = config.addressTypes;

    debug.info(DebugCategory.EMBEDDED_PROVIDER, "Browser EmbeddedProvider initialized");
  }

  getEnabledAddressTypes(): AddressType[] {
    return this.addressTypes;
  }
}
