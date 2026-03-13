/**
 * RFC 8628 OAuth 2.0 Device Authorization Grant
 *
 * Terminal-based auth alternative to browser redirect + callback server.
 * Opt-in via PHANTOM_AUTH_FLOW=device-code.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import axios, { type AxiosError } from "axios";
import * as qrcode from "qrcode-terminal";
import { Logger } from "../utils/logger";
import { DCRClient } from "./dcr";
import type { DCRClientConfig } from "../session/types";

/**
 * Options for configuring the device authorization flow
 */
export interface DeviceFlowOptions {
  /** Base URL of the authorization server (default: https://auth.phantom.app) */
  authBaseUrl?: string;
  /** Base URL of Phantom Connect — defaults to staging until device flow ships to production */
  connectBaseUrl?: string;
  /** SSO provider: google, apple, or phantom (default: google) */
  provider?: string;
  /** Pre-registered app/client ID (UUID) or DCR naming prefix (default: phantom-mcp) */
  appId?: string;
  /** Directory used for session storage — must match the SessionStorage dir so all files land in the same place (default: ~/.phantom-mcp) */
  sessionDir?: string;
}

/**
 * Result of a successful device authorization flow
 */
export interface DeviceFlowResult {
  walletId: string;
  organizationId: string;
  authUserId: string;
  clientConfig: DCRClientConfig;
  stamperKeys: {
    publicKey: string;
    secretKey: string;
  };
  oauthTokens: {
    accessToken: string;
    refreshToken: string;
    idToken?: string;
    /** Unix timestamp when the access token expires */
    expiresAt: number;
  };
}

interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  /** Minimum polling interval in seconds (RFC 8628 §3.2) */
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
}

const UUID_CLIENT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RFC 8628 Device Authorization Flow client
 *
 * Replaces browser + localhost callback server with terminal display + polling.
 * Steps:
 * 1. Resolve client config (env vars or DCR)
 * 2. Generate Ed25519 stamper keypair
 * 3. Request device code from Hydra (/oauth2/device/authorize)
 * 4. Display verification URI and user code in terminal
 * 5. Poll for tokens (/oauth2/token with device_code grant)
 * 6. Extract wallet_id / organization_id from token claims
 */
export class DeviceFlowClient {
  private readonly authBaseUrl: string;
  private readonly provider: string;
  private readonly appId: string;
  private readonly sessionDir: string;
  private readonly logger: Logger;

  constructor(options: DeviceFlowOptions = {}) {
    this.authBaseUrl = options.authBaseUrl ?? process.env.PHANTOM_AUTH_BASE_URL ?? "https://auth.phantom.app";
    const provider = options.provider ?? process.env.PHANTOM_SSO_PROVIDER ?? "google";
    if (!["google", "apple", "phantom"].includes(provider)) {
      throw new Error(`Unsupported SSO provider: ${provider}`);
    }
    this.provider = provider;
    this.appId = options.appId ?? "phantom-mcp";
    this.sessionDir = options.sessionDir ?? path.join(os.homedir(), ".phantom-mcp");
    this.logger = new Logger("DeviceFlow");
  }

  /**
   * Executes the complete device authorization flow
   *
   * @returns Promise resolving to wallet/org IDs, client config, stamper keys, and OAuth tokens
   * @throws Error if any step of the flow fails
   */
  async authenticate(): Promise<DeviceFlowResult> {
    this.logger.info("Starting device authorization flow");

    // Step 1: Resolve client config (env vars or DCR)
    const clientConfig = await this.resolveClientConfig();
    this.logger.info(`Using client ID: ${clientConfig.client_id}`);

    // Step 2: Generate Ed25519 stamper keypair
    // TODO(WP-8459): Switch to P-256 when OIDC migration lands
    this.logger.info("Step 2: Generating stamper keypair");
    const { generateKeyPair } = await import("@phantom/crypto");
    const stamperKeys = generateKeyPair();
    this.logger.info(`Stamper public key: ${stamperKeys.publicKey}`);

    // Step 3: Request device code from Hydra
    this.logger.info("Step 3: Requesting device code");
    const deviceAuth = await this.requestDeviceCode(clientConfig.client_id, stamperKeys.publicKey);

    // Step 4: Open browser and display link + code as fallback
    await this.displayDeviceCode(deviceAuth);

    // Step 5: Poll for tokens
    this.logger.info("Step 5: Polling for tokens");
    const tokens = await this.pollForTokens(
      clientConfig.client_id,
      clientConfig.client_secret,
      deviceAuth.device_code,
      deviceAuth.interval,
      deviceAuth.expires_in,
    );
    this.logger.info("Tokens received successfully");

    // Step 6: Extract wallet/org identifiers from token claims
    // NOTE(WP-8458): If Hydra doesn't include wallet_id/organization_id in claims,
    // KMS discovery via Auth2KmsRpcClient.discoverOrganizationAndWalletId() is required.
    this.logger.info("Step 6: Extracting wallet info from token claims");
    const { walletId, organizationId, authUserId } = this.extractIdentifiers(tokens);

    const now = Math.floor(Date.now() / 1000);
    return {
      walletId,
      organizationId,
      authUserId,
      clientConfig,
      stamperKeys,
      oauthTokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresAt: now + tokens.expires_in,
      },
    };
  }

  /**
   * Resolves OAuth client config from env vars, appId UUID, or DCR registration
   */
  private async resolveClientConfig(): Promise<DCRClientConfig> {
    this.logger.info("Step 1: Resolving client config");
    // NOTE: PHANTOM_APP_ID is intentionally ignored here — apps registered via
    // Portal do not have the device_code grant type and will get a 403 from Hydra.
    // Only PHANTOM_CLIENT_ID is accepted (an explicitly DCR-registered client ID).
    const envClientId = process.env.PHANTOM_CLIENT_ID?.trim();
    const envClientSecret = process.env.PHANTOM_CLIENT_SECRET?.trim();
    const hasClientSecret = Boolean(envClientSecret && envClientSecret.length > 0);

    if (envClientId) {
      this.logger.info("Using PHANTOM_CLIENT_ID from environment variables");
      this.logger.info(`Client type: ${hasClientSecret ? "confidential" : "public"}`);
      return {
        client_id: envClientId,
        client_secret: envClientSecret || "",
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
    }

    // Check for a cached DCR registration from a previous run.
    // This avoids re-registering a new client on every fresh boot.
    const agentRegPath = path.join(this.sessionDir, "agent-registration.json");
    try {
      const raw = await fs.promises.readFile(agentRegPath, "utf-8");
      const reg = JSON.parse(raw) as Partial<DCRClientConfig>;
      if (reg.client_id && UUID_CLIENT_ID_REGEX.test(reg.client_id)) {
        this.logger.info(`Using cached agent registration from ${this.sessionDir}/agent-registration.json`);
        return {
          client_id: reg.client_id,
          client_secret: reg.client_secret ?? "",
          client_id_issued_at: reg.client_id_issued_at ?? Math.floor(Date.now() / 1000),
        };
      }
      this.logger.info("agent-registration.json found but client_id is missing or not a UUID — ignoring");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.logger.info(`agent-registration.json unreadable (${code ?? String(error)}) — continuing`);
      }
    }

    const clientIdFromAppId = UUID_CLIENT_ID_REGEX.test(this.appId.trim()) ? this.appId.trim() : null;
    if (clientIdFromAppId) {
      this.logger.info("Using appId as pre-registered client ID");
      return {
        client_id: clientIdFromAppId,
        client_secret: envClientSecret || "",
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
    }

    // Fall back to DCR — register with device_code grant type
    this.logger.info("Registering OAuth client via DCR (device_code grant)");
    const dcrClient = new DCRClient(this.authBaseUrl, this.appId);
    const registration = await dcrClient.registerForDeviceFlow();
    await persistDcrRegistration(registration, this.logger, this.sessionDir);
    return registration;
  }

  /**
   * Requests a device code from the Hydra authorization server
   *
   * @param clientId - OAuth client ID
   * @param publicKey - Ed25519 stamper public key (sent to Connect for key registration)
   */
  private async requestDeviceCode(clientId: string, publicKey: string): Promise<DeviceAuthorizationResponse> {
    const endpoint = `${this.authBaseUrl}/oauth2/device/auth`;
    this.logger.debug(`Device auth endpoint: ${endpoint}`);

    const params = new URLSearchParams({
      client_id: clientId,
      scope: "openid offline_access",
      provider: this.provider,
      // Pass stamper public key so Connect can register it server-side
      // This mirrors how the SSO flow sends public_key in the auth URL
      public_key: publicKey,
    });

    try {
      const response = await axios.post<DeviceAuthorizationResponse>(endpoint, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 30000,
      });
      this.logger.debug(`User code: ${response.data.user_code}`);
      this.logger.debug(`Expires in: ${response.data.expires_in}s, interval: ${response.data.interval}s`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      const errorMessage = axiosError.response?.data ? JSON.stringify(axiosError.response.data) : axiosError.message;
      this.logger.error(`Failed to request device code: ${errorMessage}`);
      throw new Error(`Device code request failed: ${errorMessage}`);
    }
  }

  /**
   * Displays the verification URI and user code, then opens the browser.
   *
   * Primary path: opens the browser to verification_uri_complete so the user
   * just needs to approve — no manual code entry needed.
   *
   * Also prints a clickable hyperlink (OSC 8) and a scannable QR code to stderr
   * so the user can act from the terminal / MCP log viewer if the browser fails.
   */
  private async displayDeviceCode(deviceAuth: DeviceAuthorizationResponse): Promise<void> {
    const { user_code, verification_uri, verification_uri_complete } = deviceAuth;
    const urlToOpen = verification_uri_complete ?? verification_uri;

    // OSC 8 hyperlink: \x1b]8;;URL\x07LABEL\x1b]8;;\x07
    const hyperlink = `\x1b]8;;${urlToOpen}\x07${urlToOpen}\x1b]8;;\x07`;

    // Generate QR code as a string
    const qr = await new Promise<string>(resolve => {
      qrcode.generate(urlToOpen, { small: true }, resolve);
    });

    const line = (content: string) => process.stderr.write(content + "\n");

    line("");
    line("╔══════════════════════════════════════════════╗");
    line("║  Phantom Wallet — Device Authorization       ║");
    line("╠══════════════════════════════════════════════╣");
    line("║                                              ║");
    line(`║  Visit: ${verification_uri.padEnd(37)}║`);
    line(`║  Code:  ${user_code.padEnd(37)}║`);
    line("║                                              ║");
    line("║  Opening browser for you...                  ║");
    line("║  Waiting for approval...                     ║");
    line("╚══════════════════════════════════════════════╝");
    line("");
    line("  Or scan the QR code / click the link below:");
    line("");
    process.stderr.write(qr);
    line(hyperlink);
    line("");

    // Open the browser — user sees the approval page directly
    try {
      await new Promise<void>((resolve, reject) => {
        if (process.platform === "win32") {
          execFile("cmd", ["/c", "start", "", urlToOpen], err => (err ? reject(err) : resolve()));
        } else {
          const cmd = process.platform === "darwin" ? "open" : "xdg-open";
          execFile(cmd, [urlToOpen], err => (err ? reject(err) : resolve()));
        }
      });
      this.logger.info("Browser opened for device authorization");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not open browser automatically: ${msg}`);
    }
  }

  /**
   * Polls the token endpoint until the user approves or the code expires (RFC 8628 §3.4)
   *
   * @param clientId - OAuth client ID
   * @param clientSecret - OAuth client secret (empty string for public clients)
   * @param deviceCode - Device code from the device authorization response
   * @param intervalSeconds - Minimum polling interval (seconds)
   * @param expiresIn - Device code lifetime (seconds)
   */
  private async pollForTokens(
    clientId: string,
    clientSecret: string,
    deviceCode: string,
    intervalSeconds: number,
    expiresIn: number,
  ): Promise<TokenResponse> {
    const endpoint = `${this.authBaseUrl}/oauth2/token`;
    const deadline = Date.now() + expiresIn * 1000;
    let interval = intervalSeconds;
    const isPublicClient = !clientSecret || clientSecret.length === 0;

    while (Date.now() < deadline) {
      await sleep(interval * 1000);

      const params: Record<string, string> = {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
      };

      if (isPublicClient) {
        params.client_id = clientId;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };

      if (!isPublicClient) {
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        headers.Authorization = `Basic ${basicAuth}`;
      }

      try {
        const response = await axios.post<TokenResponse>(endpoint, new URLSearchParams(params).toString(), {
          headers,
          timeout: 30000,
        });
        return response.data;
      } catch (error) {
        const axiosError = error as AxiosError<{ error?: string }>;
        const errorCode = axiosError.response?.data?.error;

        if (errorCode === "authorization_pending") {
          this.logger.debug("Authorization pending, continuing to poll");
          continue;
        }
        if (errorCode === "slow_down") {
          // RFC 8628 §3.5: increase interval by 5 seconds
          interval += 5;
          this.logger.debug(`slow_down received, new interval: ${interval}s`);
          continue;
        }
        if (errorCode === "expired_token") {
          throw new Error("Device code expired. Please restart authentication.");
        }
        if (errorCode === "access_denied") {
          throw new Error("Authorization denied. The user rejected the request.");
        }

        const errorMessage = axiosError.response?.data ? JSON.stringify(axiosError.response.data) : axiosError.message;
        this.logger.error(`Token polling error: ${errorMessage}`);
        throw new Error(`Device token request failed: ${errorMessage}`);
      }
    }

    throw new Error("Device authorization timed out. Please restart authentication.");
  }

  /**
   * Extracts wallet_id, organization_id, and auth_user_id from JWT token claims.
   *
   * Decodes the id_token (or access_token as fallback) payload without verifying
   * the signature — the transport security (HTTPS) is trusted.
   *
   * NOTE(WP-8458): If Hydra does not include wallet_id/organization_id in the token
   * claims, KMS discovery via Auth2KmsRpcClient.discoverOrganizationAndWalletId()
   * will be required as a follow-up.
   */
  private extractIdentifiers(tokens: TokenResponse): {
    walletId: string;
    organizationId: string;
    authUserId: string;
  } {
    const jwt = tokens.id_token ?? tokens.access_token;
    if (!jwt) {
      throw new Error("No token available to extract wallet identifiers.");
    }

    const parts = jwt.split(".");
    if (parts.length !== 3) {
      throw new Error("Unexpected JWT format in token response.");
    }

    let claims: Record<string, unknown>;
    try {
      const payload = Buffer.from(parts[1], "base64url").toString("utf8");
      claims = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      throw new Error("Failed to decode JWT payload from token response.");
    }

    const walletId = claims["wallet_id"] as string | undefined;
    const organizationId = (claims["organization_id"] ?? claims["org_id"]) as string | undefined;
    const authUserId = (claims["auth_user_id"] ?? claims["sub"]) as string | undefined;

    if (!walletId || !organizationId || !authUserId) {
      this.logger.error(
        `Missing claims — wallet_id: ${walletId}, organization_id: ${organizationId}, auth_user_id: ${authUserId}`,
      );
      throw new Error(
        "Token claims are missing wallet_id, organization_id, or auth_user_id. " +
          "KMS discovery may be required (see WP-8458).",
      );
    }

    return { walletId, organizationId, authUserId };
  }
}

/**
 * Atomically persists a DCR registration to `<sessionDir>/agent-registration.json`
 * so subsequent runs reuse the same client instead of re-registering on every cold start.
 *
 * Write failures are caught, logged as warnings, and do not throw — the returned
 * registration object is still used for the current run.
 *
 * @param registration - The DCR client config returned by registerForDeviceFlow()
 * @param logger - Logger instance for info/warn output
 * @param sessionDir - Directory to write into (default: ~/.phantom-mcp)
 */
export async function persistDcrRegistration(
  registration: DCRClientConfig,
  logger: Logger,
  sessionDir = path.join(os.homedir(), ".phantom-mcp"),
): Promise<void> {
  try {
    await fs.promises.mkdir(sessionDir, { recursive: true, mode: 0o700 });
    const regPath = path.join(sessionDir, "agent-registration.json");
    const tmpPath = `${regPath}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(registration, null, 2), { mode: 0o600 });
    await fs.promises.rename(tmpPath, regPath);
    logger.info(
      `Agent registration cached to ${sessionDir}/agent-registration.json (client_id: ${registration.client_id})`,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to cache agent registration: ${msg} — registration will not persist across restarts`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
