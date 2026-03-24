/**
 * RPC URL resolution utilities.
 * Single source of truth for default Solana and EVM RPC endpoints.
 */

export const DEFAULT_SOLANA_RPC_URLS: Record<string, string> = {
  // CAIP-2 identifiers (used by swap/quote flows)
  "solana:101": "https://api.mainnet-beta.solana.com",
  "solana:102": "https://api.testnet.solana.com",
  "solana:103": "https://api.devnet.solana.com",
  // Phantom NetworkId identifiers (used by transfer/send flows)
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "https://api.mainnet-beta.solana.com", // NetworkId.SOLANA_MAINNET
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "https://api.devnet.solana.com", // NetworkId.SOLANA_DEVNET
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z": "https://api.testnet.solana.com", // NetworkId.SOLANA_TESTNET
};

export const DEFAULT_EVM_RPC_URLS: Record<string, string> = {
  "eip155:1": "https://node-proxy.phantom.app/v1/chain/ethereum/network/mainnet",
  "eip155:8453": "https://node-proxy.phantom.app/v1/chain/base/network/mainnet",
  "eip155:11155111": "https://sepolia.drpc.org",
  "eip155:84532": "https://sepolia.base.org",
  "eip155:137": "https://node-proxy.phantom.app/v1/chain/polygon/network/mainnet",
  "eip155:42161": "https://node-proxy.phantom.app/v1/chain/arbitrum/network/mainnet",
  "eip155:143": "https://node-proxy.phantom.app/v1/chain/monad/network/mainnet",
};

/**
 * Validates that a URL is a valid HTTPS URL with a hostname.
 */
export function validateHttpsUrl(url: string, context: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${context} URL is not valid: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${context} URL must use HTTPS protocol, got: ${parsed.protocol}`);
  }
  if (!parsed.hostname) {
    throw new Error(`${context} URL missing hostname: ${url}`);
  }
}

/**
 * Validates that a user-supplied RPC URL is safe to use:
 * - Must be a valid URL
 * - Must use the https: scheme
 * - Must not target loopback or private IP ranges (SSRF prevention)
 */
export function validateRpcUrl(url: string): void {
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
 * Resolves the Solana RPC URL to use for on-chain operations.
 * Priority: override parameter > default URL for chainId
 */
export function resolveSolanaRpcUrl(chainId: string, override?: string): string {
  let url: string;
  if (override && typeof override === "string") {
    url = override;
  } else {
    const defaultUrl = DEFAULT_SOLANA_RPC_URLS[chainId];
    if (!defaultUrl) {
      throw new Error(
        `rpcUrl is required for chainId "${chainId}". Supported defaults: ${Object.keys(DEFAULT_SOLANA_RPC_URLS).join(", ")}`,
      );
    }
    url = defaultUrl;
  }
  validateHttpsUrl(url, "Solana RPC");
  return url;
}

/**
 * Resolves the EVM RPC URL to use for on-chain operations.
 * Priority: override parameter > default URL for networkId
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
