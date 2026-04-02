/**
 * PhantomMCPServer - Main MCP server implementation
 *
 * This server:
 * - Manages session lifecycle via SessionManager
 * - Registers MCP tool handlers
 * - Communicates via stdio transport
 * - Handles tools/list and tools/call requests
 *
 * ## Session Lifecycle & Re-Authentication
 *
 * Sessions are stored in ~/.phantom-mcp/session.json as a stamper keypair.
 * Although keypairs themselves don't expire, the Phantom server can reject
 * them (returning HTTP 401 or 403) if the authenticator is revoked, the
 * app ID changes, or an admin rotates credentials.
 *
 * Detection & Recovery Pattern:
 *   1. Any tool call that hits a 401/403 triggers automatic re-authentication.
 *   2. resetSession() deletes the stored session and opens the browser for
 *      Phantom Connect sign-in (Google/Apple/Phantom extension).
 *   3. The agent receives an AUTH_EXPIRED error and should retry once the
 *      user completes browser sign-in.
 *
 * Example agent flow:
 *   → get_wallet_addresses
 *   ← {error: "...", code: "AUTH_EXPIRED"}   (session invalid — browser sign-in triggered)
 *   [user completes browser sign-in]
 *   → get_wallet_addresses  (agent retries)
 *   ← {walletId, addresses: [...]}            (success)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { AddressType, type NetworkId } from "@phantom/client";
import { PhantomApiClient, PaymentRequiredError, RateLimitError } from "@phantom/phantom-api-client";
import { base64urlEncode } from "@phantom/base64url";
import { ANALYTICS_HEADERS } from "@phantom/constants";
import { SessionManager } from "./session/manager.js";
import * as packageJson from "../package.json";
import { normalizeNetworkId } from "./utils/network.js";
import { tools, getTool } from "./tools/index.js";
import { Logger } from "./utils/logger.js";

/**
 * Returns true if the error is a 401 or 403 HTTP response from the Phantom API.
 * This indicates the stamper session has been revoked or is no longer valid.
 */
function isAuthError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const status = (error as { response?: { status?: number } }).response?.status;
    return status === 401 || status === 403;
  }
  return false;
}

/**
 * Configuration options for PhantomMCPServer
 */
export interface PhantomMCPServerOptions {
  /** Session manager configuration */
  session?: {
    authBaseUrl?: string;
    connectBaseUrl?: string;
    walletsApiBaseUrl?: string;
    callbackPort?: number;
    appId?: string;
    sessionDir?: string;
    /**
     * Authentication flow (default: "device-code" or PHANTOM_AUTH_FLOW env var).
     * - "sso": Browser redirect + localhost callback
     * - "device-code": RFC 8628 device authorization — terminal display + polling
     */
    authFlow?: "sso" | "device-code";
  };
}

/**
 * PhantomMCPServer - Main server class that wires everything together
 *
 * Usage:
 * ```typescript
 * const server = new PhantomMCPServer();
 * await server.start();
 * ```
 */
export class PhantomMCPServer {
  private readonly server: Server;
  private readonly sessionManager: SessionManager;
  private readonly logger: Logger;
  private readonly apiClient: PhantomApiClient;
  /**
   * Resolves when the startup initialization attempt finishes (success or failure).
   * Tool call handlers await this so they don't race with the OAuth browser flow.
   * The promise never rejects — errors are swallowed and logged in start().
   */
  private initPromise: Promise<void> | null = null;

  /**
   * Creates a new PhantomMCPServer instance
   *
   * @param options - Configuration options
   */
  constructor(options: PhantomMCPServerOptions = {}) {
    this.logger = new Logger("PhantomMCPServer");

    // Initialize shared API client — points at api.phantom.app by default.
    // Override with PHANTOM_API_BASE_URL to point at a different proxy or local server.
    this.apiClient = new PhantomApiClient({
      baseUrl: process.env.PHANTOM_API_BASE_URL ?? "https://api.phantom.app",
      logger: this.logger.child("api-client"),
    });

    // Initialize MCP Server
    // The server name and instructions are surfaced to agents during the MCP handshake,
    // giving them immediate context about Phantom and available capabilities.
    this.server = new Server(
      {
        name: "Phantom Wallet MCP Server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
        instructions:
          "This is the Phantom Wallet MCP Server. Phantom is an enterprise-grade non-custodial crypto wallet supporting Solana, Ethereum, Bitcoin, Base, Polygon, Sui, and Monad. " +
          "Authentication uses Phantom Connect (OAuth with Google, Apple, or Phantom extension). Sessions persist across restarts. " +
          "Available tools: get_wallet_addresses (check connection & get addresses), get_connection_status (lightweight connection check), " +
          "get_token_balances (check all token balances + USD prices via Phantom portfolio API), " +
          "transfer_tokens (SOL/SPL transfers on Solana), buy_token (Solana token swaps via Phantom routing), " +
          "sign_transaction (sign and broadcast pre-built transactions), sign_message (sign UTF-8 messages). " +
          "Always call get_wallet_addresses or get_connection_status first to confirm the user is authenticated. " +
          "Solana transactions require a small SOL balance (~0.000005 SOL) for network fees. " +
          "If an auth error occurs, re-authentication is triggered and the agent should retry after the user completes browser sign-in.",
      },
    );

    // Initialize SessionManager
    this.sessionManager = new SessionManager(options.session);

    // Setup handlers
    this.setupHandlers();

    this.logger.info("PhantomMCPServer initialized");
  }

  /**
   * Sets up MCP request handlers
   */
  private setupHandlers(): void {
    // Handle tools/list request
    this.server.setRequestHandler(ListToolsRequestSchema, () => {
      this.logger.info("Handling tools/list request");

      try {
        // Return tool definitions
        const toolDefinitions = tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        }));

        this.logger.info(`Returning ${toolDefinitions.length} tool definitions`);

        return {
          tools: toolDefinitions,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to list tools: ${errorMessage}`);
        throw error;
      }
    });

    // Handle tools/call request
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const toolName = request.params.name;
      this.logger.info(`Handling tools/call request for: ${toolName}`);

      // Wait for startup initialization to complete (OAuth browser flow may still
      // be in progress). This prevents "SessionManager not initialized" errors
      // from racing with the first-boot auth flow.
      if (this.initPromise) {
        await this.initPromise;
      }

      try {
        // Step 1: Get tool by name
        const tool = getTool(toolName);
        if (!tool) {
          const error = `Unknown tool: ${toolName}`;
          this.logger.error(error);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error }, null, 2),
              },
            ],
            isError: true,
          };
        }

        // phantom_login is handled before client/session resolution so it works
        // even when the session is not yet initialized (first run, expired, etc.)
        if (toolName === "phantom_login") {
          this.logger.info("Handling phantom_login: resetting session");
          this.logger.info(
            "Starting authentication now. If using SSO, Phantom Connect will open in your browser. " +
              "If using device-code, a device connect URL and code will be shown in the terminal.",
          );
          try {
            await this.sessionManager.resetSession();
            const session = this.sessionManager.getSession();
            this.logger.info(
              `phantom_login successful for walletId: ${session.walletId}, authFlow: ${session.authFlow}`,
            );
            try {
              await this.wirePaymentHandler();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              this.logger.error(`Failed to wire payment handler after login: ${msg}`);
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      message: "Authentication successful.",
                      walletId: session.walletId,
                      authFlow: session.authFlow ?? "device-code",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`phantom_login failed: ${errorMessage}`);
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: errorMessage }, null, 2) }],
              isError: true,
            };
          }
        }

        // Step 2: Get PhantomClient from SessionManager
        const client = this.sessionManager.getClient();
        const session = this.sessionManager.getSession();

        // Step 3: Create ToolContext
        const context = {
          client,
          session,
          logger: this.logger.child(toolName),
          apiClient: this.apiClient,
        };

        // Step 4: Execute tool handler
        this.logger.info(`Executing tool: ${toolName}`);
        const result = await tool.handler(request.params.arguments ?? {}, context);

        // Step 5: Return result as JSON string in text content
        this.logger.info(`Tool execution successful: ${toolName}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        // Step 6: On auth failure (401/403), reset the session to trigger re-authentication.
        // The agent receives an actionable error and should retry the request after sign-in.
        if (isAuthError(error)) {
          this.logger.warn(`Auth error (401/403) on tool ${toolName} — resetting session`);
          await this.sessionManager.resetSession();
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error:
                      "Session expired. Re-authentication was triggered — please complete the Phantom Connect browser sign-in and retry this request.",
                    code: "AUTH_EXPIRED",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        // Payment required: auto-pay failed (insufficient CASH, signing error, etc.)
        // Return a structured response so the agent knows exactly what happened and what to do.
        if (error instanceof PaymentRequiredError) {
          this.logger.warn(`Payment required on tool ${toolName}: auto-pay failed — ${error.message}`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: "API_PAYMENT_REQUIRED",
                    message:
                      `Daily API limit reached. Call pay_api_access with the preparedTx below to pay ` +
                      `${error.payment.amount} ${error.payment.token} and unlock access, then retry ${toolName}.`,
                    preparedTx: error.payment.preparedTx,
                    payment: {
                      amount: error.payment.amount,
                      token: error.payment.token,
                      network: error.payment.network,
                      description: error.payment.description,
                    },
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        // Rate limited: tell the agent to back off
        if (error instanceof RateLimitError) {
          this.logger.warn(`Rate limited on tool ${toolName}: retry in ${error.retryAfterMs}ms`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: "RATE_LIMITED",
                    message: `Too many requests. Wait ${Math.ceil(error.retryAfterMs / 1000)} seconds before retrying.`,
                    retryAfterMs: error.retryAfterMs,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        // Non-auth error: return as-is
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Log stack for debugging but don't expose to clients
        this.logger.error(`Tool execution failed for ${toolName}: ${errorMessage}`);
        if (error instanceof Error && error.stack) {
          this.logger.debug(`Stack trace: ${error.stack}`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: errorMessage,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    });

    this.logger.info("Request handlers registered");
  }

  /**
   * Starts the MCP server
   * - Initializes session (loads or authenticates)
   * - Connects stdio transport
   * - Begins listening for requests
   *
   * @throws Error if initialization or startup fails
   */
  async start(): Promise<void> {
    this.logger.info("Starting PhantomMCPServer");

    // Connect stdio transport FIRST so Claude Desktop can complete the MCP
    // handshake. Session initialization may open a browser for OAuth and
    // must not block the transport from connecting.
    this.logger.info("Connecting stdio transport");
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info("Server connected and ready to accept requests");

    // Initialize session after transport is connected.
    // Auth failures are caught so the server stays alive — the user can call
    // phantom_login to retry authentication without restarting the server.
    //
    // initPromise is stored on the instance so tool call handlers can await it.
    // It never rejects: errors are swallowed here so that awaiting callers
    // don't throw (they will naturally hit the getClient() guard instead).
    this.logger.info("Initializing session");
    this.initPromise = this.sessionManager
      .initialize()
      .then(() => {
        this.logger.info("Session initialized successfully");
      })
      .catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Session initialization failed: ${errorMessage}`);
        this.logger.info("Server is running unauthenticated. Call phantom_login to authenticate.");
      });

    await this.initPromise;

    // Wire payment handler after init completes so any failure here is clearly visible
    // and not silently swallowed by the session-init catch block above.
    try {
      await this.wirePaymentHandler();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to wire payment handler: ${msg} — API payment auto-pay will be disabled`);
    }
  }

  /**
   * Wires a payment handler into the shared apiClient so any 402 from the proxy
   * is automatically paid and the original request retried — no tool changes needed.
   * Called after every session init/reset so the handler always uses the current client.
   */
  private async wirePaymentHandler(): Promise<void> {
    // getClient/getSession throw if no session — don't wire if unauthenticated
    let client: ReturnType<typeof this.sessionManager.getClient>;
    let session: ReturnType<typeof this.sessionManager.getSession>;
    try {
      client = this.sessionManager.getClient();
      session = this.sessionManager.getSession();
    } catch {
      this.logger.warn("wirePaymentHandler: no active session — skipping (will retry after login)");
      return;
    }
    this.logger.info("Wiring payment handler into apiClient");

    // Set static headers — wallet address and app id are known after session init
    const appId = process.env.PHANTOM_APP_ID ?? process.env.PHANTOM_CLIENT_ID;
    const addresses = await client.getWalletAddresses(session.walletId);
    const solanaAddress = addresses.find(a => a.addressType === AddressType.solana)?.address;
    const staticHeaders: Record<string, string> = {
      [ANALYTICS_HEADERS.PLATFORM]: "ext-sdk",
      [ANALYTICS_HEADERS.CLIENT]: "mcp",
      [ANALYTICS_HEADERS.SDK_VERSION]: process.env.PHANTOM_VERSION ?? packageJson.version ?? "unknown",
    };
    if (appId) {
      staticHeaders["x-api-key"] = appId;
      staticHeaders["X-App-Id"] = appId;
    }
    if (solanaAddress) {
      staticHeaders["X-Wallet-Address"] = solanaAddress;
    }
    this.apiClient.setHeaders(staticHeaders);

    this.apiClient.setPaymentHandler(async payment => {
      this.logger.info(`Paying ${payment.amount} ${payment.token} to unlock API access`);

      // Re-resolve Solana address in case session was refreshed
      const paymentAddresses = await client.getWalletAddresses(session.walletId);
      const solanaAddress = paymentAddresses.find(a => a.addressType === AddressType.solana)?.address;
      if (!solanaAddress) throw new Error("No Solana address found for payment");

      const txBytes = Buffer.from(payment.preparedTx, "base64");
      const result = await client.signAndSendTransaction({
        walletId: session.walletId,
        transaction: base64urlEncode(txBytes),
        networkId: normalizeNetworkId("solana:mainnet") as NetworkId,
        account: solanaAddress,
      });
      if (!result.hash) throw new Error("Payment tx submitted but no signature returned");
      this.logger.info(`Payment signature: ${result.hash}`);
      return result.hash;
    });
  }
}
