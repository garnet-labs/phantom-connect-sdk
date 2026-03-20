/**
 * deposit_to_hyperliquid tool
 *
 * Thin wrapper around buy_token that targets Hypercore (Hyperliquid) as the destination.
 * All quote fetching, CrossChainQuote parsing, transaction signing and broadcasting
 * is delegated to buyTokenTool.handler() — no reimplementation.
 *
 * USDC on Hypercore is identified by the 16-byte zero address (0x00...00, 32 hex chars),
 * as used by the backend's relay withdrawal_client.ts HYPERLIQUID_USDC_ADDRESS constant.
 *
 * After this completes, call transfer_spot_to_perps to move the USDC from the
 * Hyperliquid spot account into the perp account.
 */

import { buyTokenTool } from "./buy-token.js";
import { createTool } from "./types.js";

// Hypercore chain ID used by the Phantom swapper backend
const HYPERCORE_CHAIN_ID = "hypercore:mainnet";

// USDC on Hypercore — Relay's 16-byte representation (backend HYPERLIQUID_USDC_ADDRESS)
const HYPERCORE_USDC_ADDRESS = "0x00000000000000000000000000000000";

interface Params {
  sourceChainId: string;
  amount: string;
  sellTokenMint?: string;
  sellTokenIsNative?: boolean;
  sellTokenDecimals?: number;
  execute?: boolean;
  walletId?: string;
  derivationIndex?: number;
}

export const depositToHyperliquidTool = createTool<Params>({
  name: "deposit_to_hyperliquid",
  description:
    "Bridges tokens from an external chain (Solana, Arbitrum, Base, Ethereum, Polygon) into " +
    "Hyperliquid as USDC via a cross-chain swap. " +
    "By default sells USDC on the source chain (or native SOL if sellTokenIsNative: true). " +
    "The bridge delivers USDC to your Hyperliquid spot account. " +
    "After this completes, call transfer_spot_to_perps to move USDC from spot into the perp account. " +
    "Use execute: false (default) to preview the quote first.",
  inputSchema: {
    type: "object",
    properties: {
      walletId: {
        type: "string",
        description: "Optional wallet ID (defaults to authenticated wallet)",
      },
      derivationIndex: {
        type: "integer",
        description: "Optional derivation index (default: 0)",
        minimum: 0,
      },
      sourceChainId: {
        type: "string",
        description:
          'Source chain CAIP-2 ID. Examples: "solana:mainnet", "eip155:42161" (Arbitrum), "eip155:8453" (Base), "eip155:1" (Ethereum), "eip155:137" (Polygon).',
      },
      amount: {
        type: "string",
        description: 'Amount to send in human-readable units (e.g. "100" for 100 USDC, "0.5" for 0.5 SOL).',
      },
      sellTokenMint: {
        type: "string",
        description:
          "Token contract/mint address to sell on the source chain. " +
          "Defaults to USDC on the source chain if omitted. " +
          "Solana: base58 SPL mint. EVM: lowercase 0x-prefixed ERC-20 address.",
      },
      sellTokenIsNative: {
        type: "boolean",
        description: "Set true to sell the native token (SOL on Solana, ETH on EVM chains).",
      },
      sellTokenDecimals: {
        type: "integer",
        description: "Decimals of the sell token. Required for EVM ERC-20 tokens when amountUnit is ui.",
        minimum: 0,
      },
      execute: {
        type: "boolean",
        description: "If false (default), returns the quote only. If true, signs and broadcasts immediately.",
      },
    },
    required: ["sourceChainId", "amount"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params, context) => {
    // Delegate entirely to buy_token with Hypercore as destination.
    // This reuses all quote parsing, CrossChainQuote typing, signing, and broadcasting logic.
    return buyTokenTool.handler(
      {
        walletId: params.walletId,
        derivationIndex: params.derivationIndex,
        sellChainId: params.sourceChainId,
        sellTokenMint: params.sellTokenMint,
        sellTokenIsNative: params.sellTokenIsNative,
        sellTokenDecimals: params.sellTokenDecimals,
        buyChainId: HYPERCORE_CHAIN_ID,
        buyTokenMint: HYPERCORE_USDC_ADDRESS,
        amount: params.amount,
        amountUnit: "ui",
        execute: params.execute ?? false,
      },
      context,
    );
  },
});
