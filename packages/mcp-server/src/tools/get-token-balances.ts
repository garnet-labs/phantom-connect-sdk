/**
 * get_token_balances tool - Returns fungible token balances for wallet addresses
 * using the Phantom portfolio API.
 */

import type { ToolHandler, ToolContext } from "./types.js";
import { ALL_NETWORKS, resolveNetworks, buildCaip19Addresses } from "../utils/portfolio.js";

const DEFAULT_PORTFOLIO_API_URL = "https://api.phantom.app/portfolio/v1/fungibles/balances";
const DEFAULT_PHANTOM_VERSION = "mcp-server";

export const getTokenBalancesTool: ToolHandler = {
  name: "get_token_balances",
  description:
    "Phantom Wallet — Returns fungible token balances across all supported chains " +
    "(Solana, Ethereum, Base, Polygon, Arbitrum, Bitcoin, Sui) with live USD prices and 24h price change. " +
    "Use the `networks` parameter to filter by chain — omit it to fetch all chains at once. " +
    'Examples: pass ["base"] when user asks about Base tokens; ["solana"] for Solana only; omit for all. ' +
    "Use this to check if the user has enough funds before a transfer or swap. " +
    "Response: {items: [{name, symbol, decimals, caip19, totalQuantity, totalQuantityString, spamStatus, logoUri, " +
    "price?: {price, priceChange24h}, queriedWalletBalances: [{address, quantity, quantityString}]}]}. " +
    "Key fields: totalQuantity = human-readable balance (e.g. 1.5 for 1.5 SOL), " +
    "totalQuantityString = raw base units (e.g. '1500000000' lamports), " +
    "price.price = current USD price per token, " +
    "caip19 = token identifier (parse after '/token:' to get the Solana mint address; SOL is 'slip44:501'). " +
    "Non-spam tokens have spamStatus 'VERIFIED'. Filter out spamStatus 'SPAM' tokens for cleaner output.",
  inputSchema: {
    type: "object",
    properties: {
      networks: {
        type: "array",
        items: {
          type: "string",
          enum: ALL_NETWORKS,
        },
        description:
          "Networks to fetch balances for. Omit to fetch all supported networks. " +
          'Use a subset when the user asks about a specific chain — e.g. ["base"] for "what are my Base tokens?", ' +
          '["solana", "ethereum"] for "what are my Solana and Ethereum tokens?".',
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  handler: async (params: Record<string, unknown>, context: ToolContext) => {
    const { client, session, logger } = context;

    const requestedNetworks = resolveNetworks(params.networks);

    const allAddresses = await client.getWalletAddresses(session.walletId);
    const addressByType = Object.fromEntries(allAddresses.map(a => [a.addressType.toLowerCase(), a.address]));

    const caip19Addresses = buildCaip19Addresses(requestedNetworks, addressByType);

    if (caip19Addresses.length === 0) {
      throw new Error("No wallet addresses found for the requested networks");
    }

    logger.info(`Fetching token balances for networks: ${requestedNetworks.join(", ")}`);
    logger.debug(`CAIP-19 addresses: ${caip19Addresses.join(", ")}`);

    const url = new URL(DEFAULT_PORTFOLIO_API_URL);
    url.searchParams.set("walletAddresses", caip19Addresses.join(","));
    url.searchParams.set("includePrices", "true");

    const appId =
      (typeof session.appId === "string" && session.appId) ||
      process.env.PHANTOM_APP_ID ||
      process.env.PHANTOM_CLIENT_ID;

    const headers: Record<string, string> = {
      "x-phantom-platform": "ext-sdk",
      "x-phantom-client": "mcp",
      "X-Phantom-Version": process.env.PHANTOM_VERSION ?? DEFAULT_PHANTOM_VERSION,
    };
    if (appId) {
      headers["x-api-key"] = appId;
      headers["X-App-Id"] = appId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(url.toString(), { headers, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Portfolio API request timed out after 10 seconds");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const responseText = await response.text();
    let responseJson: unknown;
    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseJson = responseText;
    }

    if (!response.ok) {
      const message = typeof responseJson === "string" ? responseJson : JSON.stringify(responseJson);
      throw new Error(`Portfolio API error (${response.status}): ${message}`);
    }

    logger.info("Successfully fetched token balances");
    return responseJson;
  },
};
