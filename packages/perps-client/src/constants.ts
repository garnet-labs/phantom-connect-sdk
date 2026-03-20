/**
 * Constants for Hyperliquid EIP-712 signing and Phantom backend URLs.
 */

export const HYPERLIQUID_MAINNET_CHAIN_ID = 42161;
export const HYPERLIQUID_TESTNET_CHAIN_ID = 421614;

/** EIP-712 domain for UsdClassTransfer actions (deposit/withdraw) */
export const HYPERLIQUID_SIGN_TRANSACTION_DOMAIN = {
  name: "HyperliquidSignTransaction",
  version: "1",
  verifyingContract: "0x0000000000000000000000000000000000000000" as const,
};

/** EIP-712 domain for Exchange actions (orders, cancel, leverage) */
export const HYPERLIQUID_EXCHANGE_DOMAIN = {
  name: "Exchange",
  version: "1",
  chainId: 1337,
  verifyingContract: "0x0000000000000000000000000000000000000000" as const,
};

export const EIP712_DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

export const APPROVE_EXCHANGE_TYPE = [
  { name: "source", type: "string" },
  { name: "connectionId", type: "bytes32" },
];

export const USD_CLASS_TRANSFER_TYPE = [
  { name: "hyperliquidChain", type: "string" },
  { name: "amount", type: "string" },
  { name: "toPerp", type: "bool" },
  { name: "nonce", type: "uint64" },
];

export const DEFAULT_API_BASE_URL = "https://api.phantom.app";

/** Arbitrum network ID used for EIP-712 signing on Hyperliquid */
export const ARBITRUM_NETWORK_ID = "eip155:42161";

/** CAIP-19 prefix for Hypercore (Hyperliquid) mainnet */
export const HYPERCORE_MAINNET_CHAIN_ID = "hypercore:mainnet";

/** 10% slippage for market orders */
export const MARKET_ORDER_SLIPPAGE = 0.1;

/** 2% slippage for spot sell orders (mirrors wallet2's BUY_SELL_PRICE_MULTIPLIER = 0.98) */
export const SPOT_SELL_SLIPPAGE = 0.02;

/** USDC token ID on Hyperliquid spot — no sell step needed when this is the bridged token */
export const USDC_SPOT_TOKEN_ID = "USDC";

/** Well-known USDC contract addresses on EVM chains */
export const USDC_ADDRESSES: Record<string, string> = {
  "eip155:1": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "eip155:42161": "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  "eip155:137": "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
};
