/**
 * get_token_balances tool - Returns fungible token balances for wallet addresses
 * using the Phantom portfolio API.
 */

import type { ToolHandler, ToolContext } from "./types.js";
import { ALL_NETWORKS, resolveNetworks, fetchPortfolioBalances } from "../utils/portfolio.js";

export const getTokenBalancesTool: ToolHandler = {
  name: "get_token_balances",
  description:
    "Phantom Wallet — Returns fungible token balances across all supported chains " +
    "(Solana, Ethereum, Base, Polygon, Arbitrum, Bitcoin, Sui) with live USD prices and 24h price change. " +
    "Use the `networks` parameter to filter by chain — omit it to fetch all chains at once. " +
    'Examples: pass ["base"] when user asks about Base tokens; ["solana"] for Solana only; omit for all. ' +
    "Use this to check if the user has enough funds before a transfer or swap. " +
    "This does not include Hyperliquid perpetuals account balances; if the user asks for Hyperliquid/perps funds or total exposure, also call get_perp_account. " +
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
    const requestedNetworks = resolveNetworks(params.networks);
    return fetchPortfolioBalances(context, requestedNetworks);
  },
};
