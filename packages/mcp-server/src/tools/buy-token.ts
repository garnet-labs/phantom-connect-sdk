/**
 * buy_token tool - Fetches a swap quote from the Phantom quotes API.
 * Supports same-chain Solana, same-chain EVM, and cross-chain swaps.
 */

import { isSolanaChain } from "@phantom/utils";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import type { ToolHandler, ToolContext } from "./types.js";
import { normalizeSwapperChainId } from "../utils/network.js";
import { getSolanaAddress } from "../utils/solana.js";
import { getEthereumAddress } from "../utils/evm.js";
import { parseBaseUnitAmount, parseUiAmount, requirePositiveAmount } from "../utils/amount.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";
import { validateTokenAddress, buildTokenObject, fetchSwapQuote, executeSwap } from "../utils/swap.js";
import { resolveSolanaRpcUrl } from "../utils/rpc.js";

export const buyTokenTool: ToolHandler = {
  name: "buy_token",
  description:
    "Phantom Wallet — Fetches an optimized swap quote from Phantom's routing engine and can optionally execute it. " +
    "Supports same-chain Solana swaps, same-chain EVM swaps (Ethereum, Base, Polygon, Arbitrum, Monad), and cross-chain swaps between Solana and EVM chains. " +
    "Cross-chain flows work in both directions, including EVM to Solana and Solana to EVM, and can also target Hypercore/Hyperliquid when supported. " +
    "Both sellChainId and buyChainId must be a Solana chain (solana:*), EVM chain (eip155:*), or Hypercore/Hyperliquid (hypercore:*); other namespaces are not supported. " +
    "Use this for ALL swap/exchange operations (e.g. 'swap USDC to SOL', 'buy ETH on Base', 'bridge SOL to ETH'). " +
    "Use sellChainId to specify the source chain and buyChainId for the destination (omit both for Solana, same as before). " +
    "For native tokens (SOL, ETH, MATIC) always use sellTokenIsNative/buyTokenIsNative — never use magic addresses like 0xeeee...eeee. " +
    'EVM token contract addresses must be lowercase (e.g. "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"). ' +
    "Two modes: (1) execute: false (default) — returns quote only; (2) execute: true — signs and broadcasts immediately. " +
    "For cross-chain swaps, execute: true sends the sell-side initiation transaction right away — the bridge completes the buy side automatically. " +
    "IMPORTANT: The wallet must hold native tokens for fees on the source chain (SOL for Solana, ETH/native for EVM). " +
    "Use get_token_balances to verify balances before executing. " +
    "Success response (execute: false): {quoteRequest, quoteResponse}. " +
    "Success response (execute: true): {quoteRequest, quoteResponse, execution: {signature, rawTransaction}}.",
  inputSchema: {
    type: "object",
    properties: {
      sellChainId: {
        type: "string",
        description:
          'CAIP-2 chain ID for the sell token (e.g. "solana:mainnet", "eip155:1" for Ethereum, "eip155:8453" for Base, "eip155:137" for Polygon). Defaults to "solana:mainnet".',
      },
      buyChainId: {
        type: "string",
        description:
          "CAIP-2 chain ID for the buy token. Defaults to sellChainId (same-chain swap). Set a different value for cross-chain (e.g. sell on Solana, buy on Ethereum).",
      },
      buyTokenMint: {
        type: "string",
        description:
          "ERC-20/SPL contract address of the token to buy. " +
          'Solana: base58 mint address. EVM: lowercase 0x-prefixed contract address (e.g. "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" for USDC). ' +
          "IMPORTANT: Do NOT use magic addresses like 0xeeee...eeee for native tokens — use buyTokenIsNative: true instead.",
      },
      buyTokenIsNative: {
        type: "boolean",
        description:
          "Set true to buy the native token of buyChainId (SOL on Solana, ETH on Base/Ethereum/Arbitrum, MATIC on Polygon). " +
          "Use this instead of buyTokenMint for native tokens. Default: false.",
      },
      sellTokenMint: {
        type: "string",
        description:
          "ERC-20/SPL contract address of the token to sell. " +
          "Solana: base58 mint address. EVM: lowercase 0x-prefixed contract address. " +
          "IMPORTANT: Do NOT use magic addresses like 0xeeee...eeee for native tokens — use sellTokenIsNative: true instead.",
      },
      sellTokenIsNative: {
        type: "boolean",
        description:
          "Set true to sell the native token of sellChainId (SOL on Solana, ETH on EVM chains). Default: true if sellTokenMint not provided.",
      },
      amount: {
        type: ["string", "number"],
        description:
          "Amount to swap. When exactOut is false (default) this is the sell amount; when exactOut is true this is the buy amount. Interpretation depends on amountUnit.",
      },
      amountUnit: {
        type: "string",
        description: "Amount unit: 'ui' for human-readable token units, 'base' for atomic units (default: 'base')",
        enum: ["ui", "base"],
      },
      buyTokenDecimals: {
        type: "number",
        description:
          "Decimals for the buy token (required when amountUnit is 'ui' and exactOut is true for EVM tokens)",
        minimum: 0,
      },
      sellTokenDecimals: {
        type: "number",
        description: "Decimals for the sell token (required when amountUnit is 'ui' for EVM tokens)",
        minimum: 0,
      },
      slippageTolerance: {
        type: "number",
        description: "Slippage tolerance in percent (0-100)",
        minimum: 0,
        maximum: 100,
      },
      exactOut: {
        type: "boolean",
        description: "If true, amount is treated as the buy amount instead of sell amount",
      },
      autoSlippage: {
        type: "boolean",
        description: "Enable auto slippage calculation",
      },
      base64EncodedTx: {
        type: "boolean",
        description: "Request base64-encoded transaction data in the quote response (Solana only)",
      },
      execute: {
        type: "boolean",
        description:
          "If true, sign and send the initiation transaction immediately. For cross-chain swaps this sends the sell-side transaction; the bridge completes the rest automatically.",
      },
      taker: {
        type: "string",
        description: "Override taker address (defaults to the wallet address for the sell chain)",
      },
      rpcUrl: {
        type: "string",
        description: "Optional Solana RPC URL (for mint decimals lookup when amountUnit is 'ui' on Solana)",
      },
      derivationIndex: {
        type: "number",
        description: "Optional derivation index for the taker address (default: 0)",
        minimum: 0,
      },
    },
    required: ["amount"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params: Record<string, unknown>, context: ToolContext) => {
    const { session, logger } = context;

    // --- Chain resolution ---
    const rawSellChain = typeof params.sellChainId === "string" ? params.sellChainId : "solana:mainnet";

    const rawBuyChain = typeof params.buyChainId === "string" ? params.buyChainId : rawSellChain;

    const sellSwapperChainId = normalizeSwapperChainId(rawSellChain);
    const buySwapperChainId = normalizeSwapperChainId(rawBuyChain);

    const isSellSolana = isSolanaChain(sellSwapperChainId);
    const isBuySolana = isSolanaChain(buySwapperChainId);
    const isSellEvm = sellSwapperChainId.startsWith("eip155:");
    const isCrossChain = sellSwapperChainId !== buySwapperChainId;

    if (!isSellSolana && !isSellEvm) {
      throw new Error(`Unsupported sell chain: ${sellSwapperChainId}. Supported: solana:*, eip155:*`);
    }

    const isBuyEvm = buySwapperChainId.startsWith("eip155:");
    // Hypercore (Hyperliquid) is a supported cross-chain destination via the Relay bridge.
    // It uses EVM-style wallet addresses but is its own chain namespace.
    const isBuyHypercore = buySwapperChainId.startsWith("hypercore:");
    if (!isBuySolana && !isBuyEvm && !isBuyHypercore) {
      throw new Error(`Unsupported buy chain: ${buySwapperChainId}. Supported: solana:*, eip155:*, hypercore:*`);
    }

    // --- Basic param validation ---
    if (typeof params.amount !== "string" && typeof params.amount !== "number") {
      throw new Error(`amount must be a string or number, got type: ${typeof params.amount}`);
    }
    const amount = params.amount as string | number;

    const walletId = typeof params.walletId === "string" ? params.walletId : session.walletId;
    if (!walletId) throw new Error("walletId is required (missing from session and not provided)");

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");

    const amountUnit = typeof params.amountUnit === "string" ? params.amountUnit : "base";
    if (amountUnit !== "ui" && amountUnit !== "base") throw new Error("amountUnit must be 'ui' or 'base'");

    const buyTokenIsNative = typeof params.buyTokenIsNative === "boolean" ? params.buyTokenIsNative : false;
    const sellTokenIsNative =
      typeof params.sellTokenIsNative === "boolean" ? params.sellTokenIsNative : params.sellTokenMint ? false : true;

    const buyTokenMint = typeof params.buyTokenMint === "string" ? params.buyTokenMint : undefined;
    const sellTokenMint = typeof params.sellTokenMint === "string" ? params.sellTokenMint : undefined;

    if (!buyTokenIsNative && !buyTokenMint) throw new Error("buyTokenMint is required unless buyTokenIsNative is true");
    if (!sellTokenIsNative && !sellTokenMint)
      throw new Error("sellTokenMint is required unless sellTokenIsNative is true");
    if (sellTokenIsNative && sellTokenMint)
      throw new Error("sellTokenMint must be omitted when sellTokenIsNative is true");

    // Validate token addresses per chain type
    if (buyTokenMint) validateTokenAddress(buyTokenMint, buySwapperChainId, "buyTokenMint");
    if (sellTokenMint) validateTokenAddress(sellTokenMint, sellSwapperChainId, "sellTokenMint");

    // --- Taker address ---
    const taker =
      typeof params.taker === "string"
        ? params.taker
        : isSellSolana
          ? await getSolanaAddress(context, walletId, derivationIndex)
          : await getEthereumAddress(context, walletId, derivationIndex);

    // Validate taker address format
    validateTokenAddress(taker, sellSwapperChainId, "taker");

    // --- Amount conversion ---
    const exactOut = typeof params.exactOut === "boolean" ? params.exactOut : false;
    let amountBaseUnits: bigint;

    if (amountUnit === "base") {
      amountBaseUnits = parseBaseUnitAmount(amount);
    } else {
      // UI units: need decimals
      let decimals: number | undefined;
      if (exactOut) {
        // Decimals for the buy token
        if (buyTokenIsNative) {
          // Native token decimals by chain
          decimals = isBuySolana ? 9 : 18;
        } else if (typeof params.buyTokenDecimals === "number") {
          if (!Number.isInteger(params.buyTokenDecimals) || params.buyTokenDecimals < 0)
            throw new Error("buyTokenDecimals must be a non-negative integer");
          decimals = params.buyTokenDecimals;
        } else if (isBuySolana && buyTokenMint) {
          // Auto-fetch from Solana chain
          const rpcUrl = resolveSolanaRpcUrl(
            buySwapperChainId,
            typeof params.rpcUrl === "string" ? params.rpcUrl : undefined,
          );
          const connection = new Connection(rpcUrl, "confirmed");
          const mintInfo = await getMint(connection, new PublicKey(buyTokenMint), "confirmed");
          decimals = mintInfo.decimals;
        } else if (!isBuySolana) {
          throw new Error("buyTokenDecimals is required for EVM tokens when amountUnit is 'ui' and exactOut is true");
        } else {
          throw new Error("buyTokenMint is required to lookup decimals");
        }
      } else {
        // Decimals for the sell token
        if (sellTokenIsNative) {
          decimals = isSellSolana ? 9 : 18;
        } else if (typeof params.sellTokenDecimals === "number") {
          if (!Number.isInteger(params.sellTokenDecimals) || params.sellTokenDecimals < 0)
            throw new Error("sellTokenDecimals must be a non-negative integer");
          decimals = params.sellTokenDecimals;
        } else if (isSellSolana && sellTokenMint) {
          const rpcUrl = resolveSolanaRpcUrl(
            sellSwapperChainId,
            typeof params.rpcUrl === "string" ? params.rpcUrl : undefined,
          );
          const connection = new Connection(rpcUrl, "confirmed");
          const mintInfo = await getMint(connection, new PublicKey(sellTokenMint), "confirmed");
          decimals = mintInfo.decimals;
        } else if (!isSellSolana) {
          throw new Error("sellTokenDecimals is required for EVM tokens when amountUnit is 'ui'");
        } else {
          throw new Error("sellTokenMint is required to lookup decimals");
        }
      }

      amountBaseUnits = parseUiAmount(amount, decimals!);
    }

    requirePositiveAmount(amountBaseUnits);

    // --- Build quote request ---
    const buyToken = buildTokenObject(buySwapperChainId, buyTokenMint, buyTokenIsNative);
    const sellToken = buildTokenObject(sellSwapperChainId, sellTokenMint, sellTokenIsNative);

    // Cross-chain: resolve destination address
    let takerDestination: { chainId: string; resourceType: string; address: string } | undefined;
    let chainAddresses: Record<string, string> | undefined;
    if (isCrossChain) {
      // Hypercore uses EVM-style addresses (same key as Arbitrum/Ethereum)
      const destinationAddress =
        isBuyEvm || isBuyHypercore
          ? await getEthereumAddress(context, walletId, derivationIndex)
          : await getSolanaAddress(context, walletId, derivationIndex);

      takerDestination = {
        chainId: buySwapperChainId,
        resourceType: "address",
        address: destinationAddress,
      };
      chainAddresses = {
        [sellSwapperChainId]: taker,
        [buySwapperChainId]: destinationAddress,
      };
    }

    if (typeof params.slippageTolerance === "number") {
      if (!Number.isFinite(params.slippageTolerance) || params.slippageTolerance < 0 || params.slippageTolerance > 100)
        throw new Error("slippageTolerance must be a number between 0 and 100");
    }

    const { quoteRequest, quoteResponse } = await fetchSwapQuote({
      sellChainId: sellSwapperChainId,
      buyChainId: buySwapperChainId,
      sellToken,
      buyToken,
      taker,
      sellAmount: exactOut ? undefined : amountBaseUnits.toString(),
      buyAmount: exactOut ? amountBaseUnits.toString() : undefined,
      exactOut,
      slippageTolerance: typeof params.slippageTolerance === "number" ? params.slippageTolerance : undefined,
      autoSlippage: typeof params.autoSlippage === "boolean" ? params.autoSlippage : true,
      base64EncodedTx: typeof params.base64EncodedTx === "boolean" ? params.base64EncodedTx : undefined,
      apiClient: context.apiClient,
      logger,
      takerDestination,
      chainAddresses,
    });

    const execute = typeof params.execute === "boolean" ? params.execute : false;

    if (!execute) {
      logger.info("Returning quote only (execute: false)");
      return { quoteRequest, quoteResponse };
    }

    logger.info(`Executing ${isCrossChain ? "cross-chain" : ""} swap transaction (execute: true)`);

    const swapResult = await executeSwap({
      quoteResponse,
      sellChainId: sellSwapperChainId,
      buyChainId: buySwapperChainId,
      rawSellChain,
      taker,
      walletId,
      derivationIndex,
      base64EncodedTx: typeof params.base64EncodedTx === "boolean" ? params.base64EncodedTx : undefined,
      client: context.client,
      logger,
      sellTokenAddress: isSellEvm && !sellTokenIsNative ? sellTokenMint : undefined,
    });

    return {
      quoteRequest,
      quoteResponse,
      execution: {
        signature: swapResult.signature,
        rawTransaction: swapResult.rawTransaction,
        explorerUrl: swapResult.explorerUrl,
      },
    };
  },
};
