/**
 * Phantom OpenClaw Plugin
 *
 * Integrates Phantom wallet operations directly with OpenClaw agents
 * by wrapping the Phantom MCP Server tools.
 */

import type { OpenClawApi } from "./client/types.js";
import { PluginSession } from "./session.js";
import { registerPhantomTools } from "./tools/register-tools.js";

// Singleton session instance
let sessionInstance: PluginSession | null = null;

/**
 * Get or create the plugin session with configuration
 */
function getSession(config?: Record<string, unknown>): PluginSession {
  if (!sessionInstance) {
    // Extract configuration from OpenClaw API config
    const appId = typeof config?.PHANTOM_APP_ID === "string" ? config.PHANTOM_APP_ID : undefined;

    // Parse callback port - accept both number and numeric string
    let callbackPort: number | undefined;
    if (typeof config?.PHANTOM_CALLBACK_PORT === "number") {
      callbackPort = config.PHANTOM_CALLBACK_PORT;
    } else if (typeof config?.PHANTOM_CALLBACK_PORT === "string") {
      const parsed = parseInt(config.PHANTOM_CALLBACK_PORT, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
        callbackPort = parsed;
      }
    }

    sessionInstance = new PluginSession({
      appId,
      callbackPort,
    });
  }
  return sessionInstance;
}

/**
 * Reset the session singleton (used for cleanup on initialization failure)
 */
function resetSession(): void {
  sessionInstance = null;
}

/**
 * Plugin registration function
 */
export default async function register(api: OpenClawApi) {
  try {
    // Initialize session (authenticate if needed)
    const session = getSession(api.config);
    await session.initialize();

    // Register all Phantom MCP tools
    registerPhantomTools(api, session);
  } catch (error) {
    console.error("Failed to initialize Phantom OpenClaw plugin:", error); // eslint-disable-line no-console
    // Reset singleton so next attempt gets a fresh instance
    resetSession();
    throw error;
  }
}
