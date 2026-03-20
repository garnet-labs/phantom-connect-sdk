/**
 * Factory helper for creating a PerpsClient from MCP tool context.
 *
 * Adapts PhantomClient into the PerpsClient's simpler (evmAddress, signTypedData) interface
 * and wires in the tool's logger so all API calls appear in the MCP debug log.
 */

import type { NetworkId } from "@phantom/client";
import { PerpsClient } from "@phantom/perps-client";
import { getEthereumAddress } from "./evm.js";
import type { ToolContext } from "../tools/types.js";

/**
 * Resolves the Phantom swap/perps API base URL.
 *
 * Priority:
 *  1. PHANTOM_PERPS_API_URL  — explicit override
 *  2. Origin of PHANTOM_QUOTES_API_URL — shares the same host as the swap API
 *  3. Origin of PHANTOM_API_BASE_URL   — strips the KMS path (/v1/wallets) to get the host
 *  4. https://api.phantom.app          — production default
 *
 * This avoids accidentally prepending the KMS path to perps endpoint URLs.
 */
function resolvePerpsApiBaseUrl(): string {
  if (process.env.PHANTOM_PERPS_API_URL) return process.env.PHANTOM_PERPS_API_URL;
  for (const envVar of [process.env.PHANTOM_QUOTES_API_URL, process.env.PHANTOM_API_BASE_URL]) {
    if (envVar) {
      try {
        return new URL(envVar).origin;
      } catch {
        // malformed URL — skip
      }
    }
  }
  return "https://api.phantom.app";
}

const DEFAULT_API_BASE_URL = resolvePerpsApiBaseUrl();

/** Arbitrum — the chain ID used for Hyperliquid EIP-712 signing */
const ARBITRUM_NETWORK_ID = "eip155:42161" as NetworkId;

/**
 * Creates a read-only PerpsClient that requires no authenticated wallet.
 * Suitable for wallet-agnostic calls such as fetching market listings.
 */
export function createAnonymousPerpsClient(context: ToolContext): PerpsClient {
  const logger = context.logger.child("perps");
  const { session } = context;
  const appId =
    (typeof session.appId === "string" && session.appId) ||
    process.env.PHANTOM_APP_ID ||
    process.env.PHANTOM_CLIENT_ID ||
    undefined;
  return new PerpsClient({
    evmAddress: "0x0000000000000000000000000000000000000000",
    signTypedData: () => Promise.reject(new Error("Not authenticated")),
    apiBaseUrl: DEFAULT_API_BASE_URL,
    appId,
    logger,
  });
}

export async function createPerpsClient(
  context: ToolContext,
  walletId: string,
  derivationIndex?: number,
): Promise<PerpsClient> {
  const evmAddress = await getEthereumAddress(context, walletId, derivationIndex);

  // Child logger so perps API calls show up as [PhantomMCPServer:perps] in the log file
  const logger = context.logger.child("perps");

  const { session } = context;
  const appId =
    (typeof session.appId === "string" && session.appId) ||
    process.env.PHANTOM_APP_ID ||
    process.env.PHANTOM_CLIENT_ID ||
    undefined;

  return new PerpsClient({
    evmAddress,
    signTypedData: typedData =>
      context.client.ethereumSignTypedData({
        walletId,
        typedData,
        networkId: ARBITRUM_NETWORK_ID,
        derivationIndex,
      }),
    apiBaseUrl: DEFAULT_API_BASE_URL,
    appId,
    logger,
  });
}
