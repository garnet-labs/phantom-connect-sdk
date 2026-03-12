/**
 * Block explorer URL builders per chain.
 * Used to generate transaction links after swaps are executed.
 */

const EXPLORER_TX_BASE: Record<string, string> = {
  // Solana
  "solana:101": "https://solscan.io/tx",
  "solana:103": "https://solscan.io/tx?cluster=devnet",
  "solana:102": "https://solscan.io/tx?cluster=testnet",

  // Ethereum
  "eip155:1": "https://etherscan.io/tx",
  "eip155:11155111": "https://sepolia.etherscan.io/tx",

  // Base
  "eip155:8453": "https://basescan.org/tx",
  "eip155:84532": "https://sepolia.basescan.org/tx",

  // Polygon
  "eip155:137": "https://polygonscan.com/tx",
  "eip155:80002": "https://amoy.polygonscan.com/tx",

  // Arbitrum
  "eip155:42161": "https://arbiscan.io/tx",
  "eip155:421614": "https://sepolia.arbiscan.io/tx",

  // Monad
  "eip155:143": "https://monadexplorer.com/tx",
  "eip155:10143": "https://testnet.monadexplorer.com/tx",
};

/**
 * Returns the block explorer transaction URL for a given chain and tx hash/signature.
 * Returns undefined if the chain has no configured explorer.
 */
export function getExplorerTxUrl(chainId: string, txHash: string): string | undefined {
  const base = EXPLORER_TX_BASE[chainId];
  if (!base) return undefined;
  // Solana devnet/testnet base already contains query params — append hash before them
  const [path, query] = base.split("?");
  return query ? `${path}/${txHash}?${query}` : `${base}/${txHash}`;
}
