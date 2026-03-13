/**
 * SessionManager orchestrates the complete session lifecycle:
 * - Loads existing sessions from storage
 * - Handles authentication when needed
 * - Creates and manages PhantomClient instances
 * - Provides session data access
 */

import { PhantomClient } from "@phantom/client";
import { ApiKeyStamper } from "@phantom/api-key-stamper";
import { ANALYTICS_HEADERS, type ServerSdkHeaders } from "@phantom/constants";
import { SessionStorage } from "./storage.js";
import { OAuthFlow } from "../auth/oauth.js";
import { DeviceFlowClient } from "../auth/device-flow.js";
import type { SessionData } from "./types.js";
import { Logger } from "../utils/logger.js";
import * as packageJson from "../../package.json";

/**
 * Configuration options for SessionManager
 */
export interface SessionManagerOptions {
  /** Base URL for OAuth authorization server (overrides PHANTOM_AUTH_BASE_URL and env-based default) */
  authBaseUrl?: string;
  /** Base URL for Phantom Connect (overrides PHANTOM_CONNECT_BASE_URL and env-based default) */
  connectBaseUrl?: string;
  /** Base URL for Phantom API (default: https://api.phantom.app or PHANTOM_API_BASE_URL env var) */
  apiBaseUrl?: string;
  /** Port for local OAuth callback server (default: 8080 or PHANTOM_CALLBACK_PORT env var) */
  callbackPort?: number;
  /** Path for OAuth callback (default: /callback or PHANTOM_CALLBACK_PATH env var) */
  callbackPath?: string;
  /** Application identifier prefix (default: phantom-mcp) */
  appId?: string;
  /** Directory to store session data (default: ~/.phantom-mcp) */
  sessionDir?: string;
  /**
   * Authentication flow to use (default: "sso" or PHANTOM_AUTH_FLOW env var).
   * - "sso": Browser redirect + localhost callback (default)
   * - "device-code": RFC 8628 device authorization — terminal display + polling
   */
  authFlow?: "sso" | "device-code";
  /**
   * Target environment (default: "production" or PHANTOM_ENV env var).
   * Controls default auth and connect base URLs when not explicitly overridden.
   * - "production": auth.phantom.app, connect.phantom.app
   * - "staging": staging-auth.phantom.app, staging-connect.phantom.app
   */
  env?: "production" | "staging";
}

/**
 * SessionManager handles session lifecycle, auto-authentication, and PhantomClient creation
 *
 * Usage:
 * ```typescript
 * const manager = new SessionManager();
 * await manager.initialize(); // Loads session or authenticates
 * const client = manager.getClient();
 * const session = manager.getSession();
 * ```
 */
export class SessionManager {
  private readonly authBaseUrl: string;
  private readonly connectBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly callbackPort: number;
  private readonly callbackPath: string;
  private readonly appId: string;
  private readonly authFlow: "sso" | "device-code";
  private readonly storage: SessionStorage;
  private readonly logger: Logger;

  private session: SessionData | null = null;
  private client: PhantomClient | null = null;

  private createMcpAnalyticsHeaders(appId: string): ServerSdkHeaders {
    return {
      [ANALYTICS_HEADERS.SDK_TYPE]: "server",
      [ANALYTICS_HEADERS.SDK_VERSION]: process.env.PHANTOM_VERSION ?? packageJson.version ?? "unknown",
      [ANALYTICS_HEADERS.PLATFORM]: "ext-sdk",
      [ANALYTICS_HEADERS.CLIENT]: "mcp",
      [ANALYTICS_HEADERS.APP_ID]: appId,
    };
  }

  private resolveAppId(): string {
    return process.env.PHANTOM_APP_ID || process.env.PHANTOM_CLIENT_ID || this.appId;
  }

  /**
   * Creates a new SessionManager
   *
   * @param options - Configuration options
   */
  constructor(options: SessionManagerOptions = {}) {
    this.logger = new Logger("SessionManager");

    // Resolve env — options take precedence; then validate the raw env var so
    // typos like PHANTOM_ENV=proudction are caught instead of silently ignored.
    let resolvedEnv: "production" | "staging";
    if (options.env !== undefined) {
      resolvedEnv = options.env;
    } else if (process.env.PHANTOM_ENV !== undefined) {
      const rawEnv = process.env.PHANTOM_ENV.trim();
      if (rawEnv !== "production" && rawEnv !== "staging") {
        throw new Error(`Invalid PHANTOM_ENV: "${rawEnv}". Must be "production" or "staging".`);
      }
      resolvedEnv = rawEnv;
    } else {
      resolvedEnv = "production";
    }
    const isStaging = resolvedEnv === "staging";

    this.authBaseUrl =
      options.authBaseUrl ??
      process.env.PHANTOM_AUTH_BASE_URL ??
      (isStaging ? "https://staging-auth.phantom.app" : "https://auth.phantom.app");

    this.connectBaseUrl =
      options.connectBaseUrl ??
      process.env.PHANTOM_CONNECT_BASE_URL ??
      (isStaging ? "https://staging-connect.phantom.app" : "https://connect.phantom.app");

    // Resolve authFlow — same pattern: options first, then validate raw env var.
    let resolvedAuthFlow: "sso" | "device-code";
    if (options.authFlow !== undefined) {
      resolvedAuthFlow = options.authFlow;
    } else if (process.env.PHANTOM_AUTH_FLOW !== undefined) {
      const rawAuthFlow = process.env.PHANTOM_AUTH_FLOW.trim();
      if (rawAuthFlow !== "sso" && rawAuthFlow !== "device-code") {
        throw new Error(`Invalid PHANTOM_AUTH_FLOW: "${rawAuthFlow}". Must be "sso" or "device-code".`);
      }
      resolvedAuthFlow = rawAuthFlow;
    } else {
      resolvedAuthFlow = "sso";
    }
    this.authFlow = resolvedAuthFlow;
    this.apiBaseUrl = options.apiBaseUrl ?? process.env.PHANTOM_API_BASE_URL ?? "https://api.phantom.app/v1/wallets";

    const defaultPort = 8080;
    const parseEnvPort = (value: string): number | null => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        return null;
      }
      return parsed;
    };

    if (options.callbackPort !== undefined) {
      if (!Number.isInteger(options.callbackPort) || options.callbackPort <= 0 || options.callbackPort > 65535) {
        throw new Error(
          `Invalid callbackPort: "${options.callbackPort}". Must be a valid port number between 1 and 65535.`,
        );
      }
      this.callbackPort = options.callbackPort;
    } else {
      const envPort = process.env.PHANTOM_CALLBACK_PORT?.trim();
      const parsedEnvPort = envPort ? parseEnvPort(envPort) : null;
      if (envPort && parsedEnvPort === null) {
        this.logger.warn(`Invalid PHANTOM_CALLBACK_PORT "${envPort}". Falling back to ${defaultPort}.`);
        this.callbackPort = defaultPort;
      } else {
        this.callbackPort = parsedEnvPort ?? defaultPort;
      }
    }

    this.callbackPath = options.callbackPath ?? process.env.PHANTOM_CALLBACK_PATH ?? "/callback";
    this.appId = options.appId ?? "phantom-mcp";
    this.storage = new SessionStorage(options.sessionDir);
  }

  /**
   * Initializes the session manager
   * Loads existing session or authenticates if needed
   *
   * @throws Error if authentication fails
   */
  async initialize(): Promise<void> {
    this.logger.info("Initializing session manager");

    // Step 1: Try to load existing session
    const existingSession = this.storage.load();

    // Step 2: Check if session is valid
    if (existingSession && !this.storage.isExpired(existingSession)) {
      this.logger.info("Loaded valid session from storage");
      this.session = existingSession;
      this.createClient();

      // Step 2a: Validate the session is still accepted server-side.
      // A stored session can be revoked without the local file changing,
      // so we make a lightweight API call to detect 401/403 on startup.
      try {
        await this.client!.getWalletAddresses(this.session.walletId);
        this.logger.info("Session validated successfully");
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 401 || status === 403) {
          this.logger.warn("Stored session rejected by server (401/403) — re-authenticating");
          this.storage.delete();
          this.session = null;
          this.client = null;
          await this.authenticate();
          return;
        }
        // Non-auth errors (network down, timeout) — keep the session and proceed
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Session validation network error (${errorMessage}) — proceeding with cached session`);
      }
      return;
    }

    // Step 3: Session is missing or expired - authenticate
    if (existingSession) {
      this.logger.info("Session expired, re-authenticating");
    } else {
      this.logger.info("No session found, authenticating");
    }

    await this.authenticate();
  }

  /**
   * Returns whether the session manager has an active, loaded session.
   *
   * This is a synchronous local check — it does NOT make a network call and
   * cannot detect server-side session revocation. A truthy result means a
   * session file was loaded; it does not guarantee the server will accept it.
   *
   * On startup, initialize() proactively validates a loaded session via a
   * lightweight API call and re-authenticates immediately if it returns 401/403.
   * During normal operation, any tool call that receives 401/403 automatically
   * calls resetSession(), opens the browser for re-auth, and returns AUTH_EXPIRED
   * so the agent can retry.
   *
   * @returns true if a session is loaded in memory
   */
  isInitialized(): boolean {
    return this.session !== null && this.client !== null;
  }

  /**
   * Returns the initialized PhantomClient
   *
   * @returns PhantomClient instance
   * @throws Error if not initialized
   */
  getClient(): PhantomClient {
    if (!this.client) {
      throw new Error("SessionManager not initialized. Call initialize() first.");
    }
    return this.client;
  }

  /**
   * Returns the current session data
   *
   * @returns Current session data
   * @throws Error if not initialized
   */
  getSession(): SessionData {
    if (!this.session) {
      throw new Error("SessionManager not initialized. Call initialize() first.");
    }
    return this.session;
  }

  /**
   * Resets the session by clearing stored data and re-authenticating
   *
   * @throws Error if authentication fails
   */
  async resetSession(): Promise<void> {
    this.logger.info("Resetting session");

    // Clear stored session
    this.storage.delete();
    this.session = null;
    this.client = null;

    // Re-authenticate
    await this.authenticate();
  }

  /**
   * Authenticates using the configured auth flow and creates a new session.
   * Delegates to SSO (browser + callback) or device-code (terminal + poll) flow.
   *
   * @throws Error if authentication fails
   */
  private async authenticate(): Promise<void> {
    this.logger.info(`Starting authentication (flow: ${this.authFlow})`);

    if (this.authFlow === "device-code") {
      await this.authenticateWithDeviceFlow();
    } else {
      await this.authenticateWithSso();
    }
  }

  /**
   * Executes the SSO flow (browser redirect + localhost callback) and creates a new session.
   *
   * @throws Error if SSO flow fails
   */
  private async authenticateWithSso(): Promise<void> {
    const oauthFlow = new OAuthFlow({
      authBaseUrl: this.authBaseUrl,
      connectBaseUrl: this.connectBaseUrl,
      callbackPort: this.callbackPort,
      callbackPath: this.callbackPath,
      appId: this.appId,
    });

    const result = await oauthFlow.authenticate();
    this.logger.info("SSO flow completed successfully");

    const now = Math.floor(Date.now() / 1000);
    this.session = {
      walletId: result.walletId,
      organizationId: result.organizationId,
      authUserId: result.authUserId,
      appId: result.clientConfig.client_id,
      authFlow: "sso",
      stamperKeys: result.stamperKeys,
      createdAt: now,
      updatedAt: now,
    };

    this.storage.save(this.session);
    this.logger.info("Session saved to storage");
    this.createClient();
  }

  /**
   * Executes the RFC 8628 device authorization flow (terminal display + polling) and creates a new session.
   *
   * @throws Error if device flow fails
   */
  private async authenticateWithDeviceFlow(): Promise<void> {
    const deviceFlow = new DeviceFlowClient({
      authBaseUrl: this.authBaseUrl,
      connectBaseUrl: this.connectBaseUrl,
      appId: this.appId,
      sessionDir: this.storage.sessionDir,
    });

    const result = await deviceFlow.authenticate();
    this.logger.info("Device authorization flow completed successfully");

    const now = Math.floor(Date.now() / 1000);
    this.session = {
      walletId: result.walletId,
      organizationId: result.organizationId,
      authUserId: result.authUserId,
      appId: result.clientConfig.client_id,
      authFlow: "device-code",
      stamperKeys: result.stamperKeys,
      oauthTokens: result.oauthTokens,
      createdAt: now,
      updatedAt: now,
    };

    this.storage.save(this.session);
    this.logger.info("Session saved to storage");
    this.createClient();
  }

  /**
   * Creates a PhantomClient instance from the current session
   * Steps:
   * 1. Create ApiKeyStamper with session keypair
   * 2. Create PhantomClient with stamper, organizationId, and app headers
   * 3. Set walletType to 'user-wallet'
   *
   * @throws Error if session is not available
   */
  private createClient(): void {
    if (!this.session) {
      throw new Error("Cannot create client without session");
    }

    this.logger.info("Creating PhantomClient");

    // Step 1: Create ApiKeyStamper with session keypair
    const stamper = new ApiKeyStamper({
      apiSecretKey: this.session.stamperKeys.secretKey,
    });

    // Step 2: Get client ID for X-App-Id header
    const appId = this.session.appId || this.resolveAppId();

    const headers = this.createMcpAnalyticsHeaders(appId);

    // Step 3: Create PhantomClient with stamper, organizationId, and headers
    this.client = new PhantomClient(
      {
        apiBaseUrl: this.apiBaseUrl,
        organizationId: this.session.organizationId,
        walletType: "user-wallet",
        headers,
        logger: this.logger,
      },
      stamper,
    );

    this.logger.info("PhantomClient created successfully");
  }
}
