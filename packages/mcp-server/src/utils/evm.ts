/**
 * EVM utility functions for MCP tools.
 * Mirrors the pattern of utils/solana.ts for EVM chains.
 */

import { AddressType } from "@phantom/client";
import type { ToolContext } from "../tools/types.js";

const DEFAULT_EVM_RPC_URLS: Record<string, string> = {
  "eip155:1": "https://node-proxy.phantom.app/v1/chain/ethereum/network/mainnet",
  "eip155:8453": "https://node-proxy.phantom.app/v1/chain/base/network/mainnet",
  "eip155:11155111": "https://sepolia.drpc.org",
  "eip155:84532": "https://sepolia.base.org",
  "eip155:137": "https://node-proxy.phantom.app/v1/chain/polygon/network/mainnet",
  "eip155:42161": "https://node-proxy.phantom.app/v1/chain/arbitrum/network/mainnet",
  "eip155:143": "https://node-proxy.phantom.app/v1/chain/monad/network/mainnet",
};

/**
 * Asserts that a string is a valid EVM address (0x-prefixed, exactly 40 hex chars).
 * Throws a descriptive error if the check fails.
 */
export function assertEvmAddress(value: string, paramName: string = "address"): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${paramName} must be a valid EVM address (0x-prefixed, 40 hex chars)`);
  }
}

/**
 * Retrieves the Ethereum/EVM address for a given wallet.
 * Mirrors getSolanaAddress() in utils/solana.ts.
 *
 * @param context - Tool context containing the client
 * @param walletId - The wallet ID to fetch the address for
 * @param derivationIndex - Optional derivation index for the account
 * @returns The Ethereum address as a string (checksummed)
 * @throws Error if no Ethereum address is found for the wallet
 */
export async function getEthereumAddress(
  context: ToolContext,
  walletId: string,
  derivationIndex?: number,
): Promise<string> {
  const addresses = await context.client.getWalletAddresses(walletId, undefined, derivationIndex);
  const ethereumAddress =
    addresses.find(addr => addr.addressType === AddressType.ethereum) ||
    addresses.find(
      addr => addr.addressType.toLowerCase() === "ethereum" || addr.addressType.toLowerCase() === "eip155",
    );

  if (!ethereumAddress) {
    throw new Error("No Ethereum address found for this wallet");
  }

  return ethereumAddress.address;
}

/**
 * Validates that a user-supplied RPC URL is safe to use:
 * - Must be a valid URL
 * - Must use the https: scheme
 * - Must not target loopback or private IP ranges (SSRF prevention)
 */
function validateRpcUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`rpcUrl is not a valid URL: ${url}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`rpcUrl must use https:, got: ${parsed.protocol}`);
  }

  const h = parsed.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    /^10\.\d+\.\d+\.\d+$/.test(h) ||
    /^192\.168\.\d+\.\d+$/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h) ||
    /^169\.254\.\d+\.\d+$/.test(h)
  ) {
    throw new Error(`rpcUrl hostname is not permitted: ${h}`);
  }
}

/**
 * Resolves the EVM RPC URL to use for on-chain operations.
 * Priority: override parameter > default URL for networkId
 *
 * @param networkId - The CAIP-2 network ID (e.g. "eip155:1", "eip155:8453")
 * @param override - Optional RPC URL override
 * @returns The resolved RPC URL
 * @throws Error if networkId is not supported and no override is provided
 */
export function resolveEvmRpcUrl(networkId: string, override?: string): string {
  if (override && typeof override === "string") {
    validateRpcUrl(override);
    return override;
  }

  const defaultUrl = DEFAULT_EVM_RPC_URLS[networkId];
  if (!defaultUrl) {
    throw new Error(
      `rpcUrl is required for networkId "${networkId}". Supported defaults: ${Object.keys(DEFAULT_EVM_RPC_URLS).join(", ")}`,
    );
  }

  return defaultUrl;
}

/**
 * Estimate gas for a transaction via JSON-RPC.
 * Adds a 20% buffer on top of the estimate for safety.
 *
 * @param rpcUrl - EVM JSON-RPC endpoint
 * @param tx - Transaction object to estimate gas for
 * @returns Gas estimate as a hex string (with 20% buffer)
 */
export async function estimateGas(rpcUrl: string, tx: Record<string, unknown>): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_estimateGas",
      params: [tx],
      id: 1,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to estimate gas: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { result?: string; error?: { message: string } };
  if (data.error) {
    throw new Error(`Failed to estimate gas: ${data.error.message}`);
  }
  if (!data.result) {
    throw new Error("Failed to estimate gas: empty result");
  }

  // Add 20% buffer
  const estimated = BigInt(data.result);
  const withBuffer = (estimated * 120n) / 100n;
  return "0x" + withBuffer.toString(16);
}

/**
 * Fetch the current nonce (transaction count) for an address via JSON-RPC.
 *
 * @param rpcUrl - EVM JSON-RPC endpoint
 * @param address - EVM address to fetch nonce for
 * @returns Nonce as a hex string
 */
export async function fetchNonce(rpcUrl: string, address: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getTransactionCount",
      params: [address, "pending"],
      id: 1,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch nonce: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { result?: string; error?: { message: string } };
  if (data.error) {
    throw new Error(`Failed to fetch nonce: ${data.error.message}`);
  }
  if (!data.result) {
    throw new Error("Failed to fetch nonce: empty result");
  }

  return data.result;
}

/**
 * Fetch the current gas price via JSON-RPC.
 *
 * @param rpcUrl - EVM JSON-RPC endpoint
 * @returns Gas price as a hex string
 */
export async function fetchGasPrice(rpcUrl: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_gasPrice",
      params: [],
      id: 1,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch gas price: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { result?: string; error?: { message: string } };
  if (data.error) {
    throw new Error(`Failed to fetch gas price: ${data.error.message}`);
  }
  if (!data.result) {
    throw new Error("Failed to fetch gas price: empty result");
  }

  return data.result;
}
