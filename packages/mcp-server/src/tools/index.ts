/**
 * MCP Tools Registry
 *
 * Chain-specific tools for Solana and EVM chains.
 * Tools mirror the browser-sdk's chain-specific API pattern (sdk.solana.*, sdk.ethereum.*).
 */

import { getWalletAddressesTool } from "./get-wallet-addresses.js";
import { getConnectionStatusTool } from "./get-connection-status.js";
import { getTokenBalancesTool } from "./get-token-balances.js";
import { transferTokensTool } from "./transfer-tokens.js";
import { buyTokenTool } from "./buy-token.js";
import { loginTool } from "./login.js";
import { sendSolanaTransactionTool } from "./send-solana-transaction.js";
import { sendEvmTransactionTool } from "./send-evm-transaction.js";
import { signSolanaMessageTool } from "./sign-solana-message.js";
import { signEvmPersonalMessageTool } from "./sign-evm-personal-message.js";
import { signEvmTypedDataTool } from "./sign-evm-typed-data.js";
import { getPerpMarketsTool } from "./get-perp-markets.js";
import { getPerpAccountTool } from "./get-perp-account.js";
import { getPerpPositionsTool } from "./get-perp-positions.js";
import { getPerpOrdersTool } from "./get-perp-orders.js";
import { getPerpTradeHistoryTool } from "./get-perp-trade-history.js";
import { openPerpPositionTool } from "./open-perp-position.js";
import { closePerpPositionTool } from "./close-perp-position.js";
import { cancelPerpOrderTool } from "./cancel-perp-order.js";
import { updatePerpLeverageTool } from "./update-perp-leverage.js";
import { transferSpotToPerpsTool } from "./transfer-spot-to-perps.js";
import { depositToHyperliquidTool } from "./deposit-to-hyperliquid.js";
import { withdrawFromPerpsTool } from "./withdraw-from-perps.js";
import type { ToolHandler } from "./types.js";

/**
 * Array of all available tools
 */
export const tools: ToolHandler[] = [
  loginTool,
  // Wallet utilities
  getWalletAddressesTool,
  getConnectionStatusTool,
  getTokenBalancesTool,
  // Solana tools
  sendSolanaTransactionTool,
  signSolanaMessageTool,
  transferTokensTool,
  buyTokenTool,
  // EVM tools
  sendEvmTransactionTool,
  signEvmPersonalMessageTool,
  signEvmTypedDataTool,
  // Perps tools (read)
  getPerpMarketsTool,
  getPerpAccountTool,
  getPerpPositionsTool,
  getPerpOrdersTool,
  getPerpTradeHistoryTool,
  // Perps tools (write)
  openPerpPositionTool,
  closePerpPositionTool,
  cancelPerpOrderTool,
  updatePerpLeverageTool,
  transferSpotToPerpsTool,
  withdrawFromPerpsTool,
  depositToHyperliquidTool,
];

/**
 * Get a tool by name
 * @param name - The name of the tool to retrieve
 * @returns The tool handler or undefined if not found
 */
export function getTool(name: string): ToolHandler | undefined {
  return tools.find(tool => tool.name === name);
}

/**
 * Get all tool names
 * @returns Array of tool names
 */
export function getToolNames(): string[] {
  return tools.map(tool => tool.name);
}

// Re-export types
export type { ToolHandler, ToolContext, ToolInputSchema } from "./types.js";
