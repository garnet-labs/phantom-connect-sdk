/**
 * Utilities for building Phantom Portfolio API requests.
 */

/**
 * Maps agent-friendly network names to wallet address type and CAIP-19 chain prefix.
 * EVM chains (ethereum, base, polygon, arbitrum) share the same wallet address.
 */
export const NETWORK_CONFIGS: Record<string, { addressType: string; caip19Prefix: string }> = {
  solana: { addressType: "solana", caip19Prefix: "solana:101" },
  ethereum: { addressType: "ethereum", caip19Prefix: "eip155:1" },
  base: { addressType: "ethereum", caip19Prefix: "eip155:8453" },
  polygon: { addressType: "ethereum", caip19Prefix: "eip155:137" },
  arbitrum: { addressType: "ethereum", caip19Prefix: "eip155:42161" },
  monad: { addressType: "ethereum", caip19Prefix: "eip155:143" },
  bitcoin: { addressType: "bitcoinsegwit", caip19Prefix: "bip122:000000000019d6689c085ae165831e93" },
  sui: { addressType: "sui", caip19Prefix: "sui:mainnet" },
};

export const ALL_NETWORKS = Object.keys(NETWORK_CONFIGS);

/**
 * Resolves the list of networks to query.
 * Returns the provided array if non-empty, otherwise defaults to all supported networks.
 * Filters out any unrecognised network names.
 *
 * @param networks - Raw value from tool params (may be undefined or any type)
 * @returns Array of valid network name strings
 */
export function resolveNetworks(networks: unknown): string[] {
  if (!Array.isArray(networks) || networks.length === 0) {
    return ALL_NETWORKS;
  }
  return networks.filter((n): n is string => typeof n === "string" && n in NETWORK_CONFIGS);
}

/**
 * Builds CAIP-19 wallet address strings for the requested networks.
 *
 * @param networks - Network names to include (from resolveNetworks)
 * @param addressByType - Map of address type (lowercase) → wallet address
 * @returns Array of CAIP-19 address strings ready for the Portfolio API
 */
export function buildCaip19Addresses(networks: string[], addressByType: Record<string, string>): string[] {
  const caip19Addresses: string[] = [];

  for (const network of networks) {
    const config = NETWORK_CONFIGS[network];
    if (!config) continue;

    const addr = addressByType[config.addressType];
    if (addr) {
      caip19Addresses.push(`${config.caip19Prefix}/address:${addr}`);
    }
  }

  return caip19Addresses;
}
