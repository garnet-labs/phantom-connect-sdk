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
const PLUGIN_ID = "phantom-openclaw-plugin";

const STRING_CONFIG_KEYS = [
  "PHANTOM_AUTH_BASE_URL",
  "PHANTOM_CONNECT_BASE_URL",
  "PHANTOM_WALLETS_API_BASE_URL",
  "PHANTOM_API_BASE_URL",
  "PHANTOM_VERSION",
  "PHANTOM_CALLBACK_PATH",
  "PHANTOM_MCP_DEBUG",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * OpenClaw passes the full openclaw.json object as api.config.
 * Extract this plugin's scoped config when available.
 */
function getPluginConfig(fullConfig?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!fullConfig) {
    return undefined;
  }

  const plugins = fullConfig.plugins;
  if (!isRecord(plugins)) {
    return fullConfig;
  }

  const entries = plugins.entries;
  if (!isRecord(entries)) {
    return fullConfig;
  }

  const pluginEntry = entries[PLUGIN_ID];
  if (!isRecord(pluginEntry)) {
    return fullConfig;
  }

  const pluginConfig = pluginEntry.config;
  if (isRecord(pluginConfig)) {
    return pluginConfig;
  }

  return fullConfig;
}

function applyConfigToEnv(config?: Record<string, unknown>): void {
  if (!config) {
    return;
  }

  for (const key of STRING_CONFIG_KEYS) {
    const value = config[key];
    if (typeof value === "string" && value.trim().length > 0) {
      process.env[key] = value.trim();
    }
  }

  const rawPort = config.PHANTOM_CALLBACK_PORT;
  let parsedPort: number | null = null;

  if (typeof rawPort === "number") {
    parsedPort = rawPort;
  } else if (typeof rawPort === "string") {
    const parsed = Number.parseInt(rawPort, 10);
    parsedPort = Number.isNaN(parsed) ? null : parsed;
  }

  if (parsedPort !== null && Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    process.env.PHANTOM_CALLBACK_PORT = String(parsedPort);
  }
}

/**
 * Get or create the plugin session with configuration
 */
function getSession(config?: Record<string, unknown>): PluginSession {
  if (!sessionInstance) {
    const pluginConfig = getPluginConfig(config);
    applyConfigToEnv(pluginConfig);
    const envPort = process.env.PHANTOM_CALLBACK_PORT?.trim();
    const parsedPort = envPort ? Number.parseInt(envPort, 10) : NaN;
    const callbackPort = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : undefined;

    sessionInstance = new PluginSession({
      callbackPort,
      authFlow: "device-code",
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
