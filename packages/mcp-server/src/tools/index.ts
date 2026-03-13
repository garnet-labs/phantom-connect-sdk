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
