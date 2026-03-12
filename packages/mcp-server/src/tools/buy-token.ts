/**
 * buy_token tool - Fetches a swap quote from the Phantom quotes API.
 * Supports same-chain Solana, same-chain EVM, and cross-chain swaps.
 */

import type { NetworkId } from "@phantom/client";
import { isSolanaChain } from "@phantom/utils";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import bs58 from "bs58";
import { base64urlEncode } from "@phantom/base64url";
import { parseToKmsTransaction } from "@phantom/parsers";
import type { ToolHandler, ToolContext } from "./types.js";
import type {
  SolanaQuote,
  EvmSameChainQuote,
  CrossChainQuote,
  SolanaOriginCrossChainStep,
  EvmOriginCrossChainStep,
} from "../utils/quotes.js";
import { normalizeNetworkId, normalizeSwapperChainId } from "../utils/network.js";
import { getSolanaAddress } from "../utils/solana.js";
import { getEthereumAddress, resolveEvmRpcUrl, fetchNonce, fetchGasPrice, estimateGas } from "../utils/evm.js";
import { getExplorerTxUrl } from "../utils/explorers.js";
import { parseBaseUnitAmount, parseUiAmount, requirePositiveAmount } from "../utils/amount.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";

const DEFAULT_QUOTES_API_URL = "https://api.phantom.app/swap/v2/quotes";
const DEFAULT_PHANTOM_VERSION = "mcp-server";

const DEFAULT_SOLANA_RPC_URLS: Record<string, string> = {
  "solana:101": "https://api.mainnet-beta.solana.com",
  "solana:103": "https://api.devnet.solana.com",
  "solana:102": "https://api.testnet.solana.com",
};

function validateHttpsUrl(url: string, context: string): void {
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

function resolveQuotesApiUrl(override?: string): string {
  let url: string;
  if (override && typeof override === "string") {
    url = override;
  } else if (process.env.PHANTOM_QUOTES_API_URL) {
    url = process.env.PHANTOM_QUOTES_API_URL;
  } else {
    url = DEFAULT_QUOTES_API_URL;
  }
  validateHttpsUrl(url, "Quotes API");
  return url;
}

function resolveSolanaRpcUrl(chainId: string, override?: string): string {
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

function decodeTransactionData(transactionData: string, base64Encoded: boolean | undefined): Uint8Array {
  if (base64Encoded) {
    const bytes = Buffer.from(transactionData, "base64");
    if (!bytes.length) throw new Error("Failed to decode base64 transaction data");
    return bytes;
  }
  try {
    return bs58.decode(transactionData);
  } catch (error) {
    const bytes = Buffer.from(transactionData, "base64");
    if (!bytes.length) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to decode transaction data: ${errorMessage}`);
    }
    return bytes;
  }
}

/**
 * Validates a token address for the given chain.
 * Solana: must be a valid base58 PublicKey.
 * EVM: must be a 0x-prefixed hex address.
 */
function validateTokenAddress(address: string, chainId: string, paramName: string): void {
  if (isSolanaChain(chainId)) {
    try {
      new PublicKey(address);
    } catch {
      throw new Error(`${paramName} must be a valid Solana address`);
    }
  } else if (chainId.startsWith("eip155:")) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error(`${paramName} must be a valid EVM address (0x-prefixed, 40 hex chars)`);
    }
  }
}

/**
 * Slip44 identifier for the native token of each EVM chain as used by the Phantom quotes API.
 * These match the nativeToken component of the CAIP-19 identifiers returned by the Phantom
 * portfolio API (e.g. eip155:8453/nativeToken:8453), which may differ from the SLIP-44 registry.
 *
 * Values confirmed from Phantom portfolio API caip19 fields:
 *   eip155:1     → nativeToken:60   (ETH, SLIP-44 registered)
 *   eip155:8453  → nativeToken:8453 (Base ETH, uses chain ID)
 *   eip155:42161 → nativeToken:9001 (Arbitrum ETH)
 *   eip155:137   → nativeToken:966  (MATIC, SLIP-44 registered)
 */
const EVM_NATIVE_SLIP44: Record<string, string> = {
  "eip155:1": "60", // ETH — Ethereum mainnet
  "eip155:11155111": "60", // ETH — Sepolia
  "eip155:8453": "8453", // ETH — Base
  "eip155:84532": "84532", // ETH — Base Sepolia
  "eip155:42161": "9001", // ETH — Arbitrum One
  "eip155:421614": "9001", // ETH — Arbitrum Sepolia
  "eip155:137": "966", // MATIC — Polygon
  "eip155:80002": "966", // MATIC — Polygon Amoy
  "eip155:143": "143", // ETH — Monad mainnet
  "eip155:10143": "10143", // ETH — Monad testnet
};

/**
 * Builds the token object for the Phantom quotes API.
 * Native tokens require slip44; EVM chains each have a specific coin type.
 */
function buildTokenObject(chainId: string, mint: string | undefined, isNative: boolean): Record<string, unknown> {
  if (isNative) {
    if (isSolanaChain(chainId)) {
      return { chainId, resourceType: "nativeToken", slip44: "501" };
    }
    const slip44 = EVM_NATIVE_SLIP44[chainId];
    if (!slip44) {
      throw new Error(
        `Native token slip44 not configured for chain ${chainId}. Supported EVM chains: ${Object.keys(EVM_NATIVE_SLIP44).join(", ")}`,
      );
    }
    return { chainId, resourceType: "nativeToken", slip44 };
  }
  // Backend requires lowercase EVM addresses
  const normalizedMint = chainId.startsWith("eip155:") && mint ? mint.toLowerCase() : mint;
  return { chainId, resourceType: "address", address: normalizedMint };
}

export const buyTokenTool: ToolHandler = {
  name: "buy_token",
  description:
    "Phantom Wallet — Fetches an optimized swap quote from Phantom's routing engine and can optionally execute it. " +
    "Supports same-chain Solana swaps, same-chain EVM swaps (Ethereum, Base, Polygon, Arbitrum, Monad), and cross-chain swaps between Solana and EVM chains. " +
    "Both sellChainId and buyChainId must be either a Solana chain (solana:*) or an EVM chain (eip155:*); other namespaces (bip122, sui, etc.) are not supported. " +
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
      walletId: {
        type: "string",
        description: "Optional wallet ID (defaults to authenticated wallet)",
      },
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
      quoteApiUrl: {
        type: "string",
        description:
          "Optional Phantom-compatible quotes API URL override. Do not use Jupiter or other third-party endpoints.",
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
    if (!isBuySolana && !isBuyEvm) {
      throw new Error(`Unsupported buy chain: ${buySwapperChainId}. Supported: solana:*, eip155:*`);
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

    // --- Build quote request body ---
    const quoteApiUrl = resolveQuotesApiUrl(typeof params.quoteApiUrl === "string" ? params.quoteApiUrl : undefined);

    const buyToken = buildTokenObject(buySwapperChainId, buyTokenMint, buyTokenIsNative);
    const sellToken = buildTokenObject(sellSwapperChainId, sellTokenMint, sellTokenIsNative);

    const body: Record<string, unknown> = {
      taker: { chainId: sellSwapperChainId, resourceType: "address", address: taker },
      buyToken,
      sellToken,
    };

    if (exactOut) {
      body.buyAmount = amountBaseUnits.toString();
    } else {
      body.sellAmount = amountBaseUnits.toString();
    }

    // Cross-chain: add takerDestination and chainAddresses
    if (isCrossChain) {
      const destinationAddress = isBuyEvm
        ? await getEthereumAddress(context, walletId, derivationIndex)
        : await getSolanaAddress(context, walletId, derivationIndex);

      body.takerDestination = {
        chainId: buySwapperChainId,
        resourceType: "address",
        address: destinationAddress,
      };
      body.chainAddresses = {
        [sellSwapperChainId]: taker,
        [buySwapperChainId]: destinationAddress,
      };
    }

    if (typeof params.slippageTolerance === "number") {
      if (!Number.isFinite(params.slippageTolerance) || params.slippageTolerance < 0 || params.slippageTolerance > 100)
        throw new Error("slippageTolerance must be a number between 0 and 100");
      body.slippageTolerance = params.slippageTolerance;
    }
    if (typeof params.exactOut === "boolean") body.exactOut = exactOut;
    body.autoSlippage = typeof params.autoSlippage === "boolean" ? params.autoSlippage : true;
    if (typeof params.base64EncodedTx === "boolean") body.base64EncodedTx = params.base64EncodedTx;

    const quoteApiOrigin = new URL(quoteApiUrl).origin;
    logger.info(
      `Requesting ${isCrossChain ? "cross-chain" : isSellSolana ? "Solana" : "EVM"} quote from ${quoteApiOrigin} (${sellSwapperChainId} → ${buySwapperChainId})`,
    );

    const appId =
      (typeof session.appId === "string" && session.appId) ||
      process.env.PHANTOM_APP_ID ||
      process.env.PHANTOM_CLIENT_ID;
    if (!appId) logger.warn("Quote request missing app id; sending request without x-api-key header");

    const quoteHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "x-phantom-platform": "ext-sdk",
      "x-phantom-client": "mcp",
      "X-Phantom-Version": process.env.PHANTOM_VERSION ?? DEFAULT_PHANTOM_VERSION,
    };
    if (appId) {
      quoteHeaders["x-api-key"] = appId;
      quoteHeaders["X-App-Id"] = appId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(quoteApiUrl, {
        method: "POST",
        headers: quoteHeaders,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        throw new Error("Quote API request timed out after 10 seconds");
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const responseText = await response.text();
    let responseJson: unknown;
    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch (parseError) {
      logger.debug(`Failed to parse response as JSON: ${parseError}`);
      responseJson = responseText;
    }

    if (!response.ok) {
      const message = typeof responseJson === "string" ? responseJson : JSON.stringify(responseJson);
      if (response.status === 405) {
        throw new Error(`Quote API error (405): ${message}. Endpoint must accept POST with Phantom quote schema.`);
      }
      throw new Error(`Quote API error (${response.status}): ${message}`);
    }

    const execute = typeof params.execute === "boolean" ? params.execute : false;

    if (!execute) {
      logger.info("Returning quote only (execute: false)");
      logger.debug(`[TX_DEBUG] allQuotes=${JSON.stringify((responseJson as Record<string, unknown>)?.quotes)}`);
      return { quoteRequest: body, quoteResponse: responseJson };
    }

    logger.info(`Executing ${isCrossChain ? "cross-chain" : ""} swap transaction (execute: true)`);

    if (
      typeof responseJson !== "object" ||
      responseJson === null ||
      !Array.isArray((responseJson as Record<string, unknown>).quotes)
    ) {
      throw new Error(
        `Quote response has unexpected format: expected object with quotes array, got ${typeof responseJson}`,
      );
    }

    const quotes = (responseJson as { quotes: unknown[] }).quotes;
    if (quotes.length === 0) throw new Error("Quote response contains empty quotes array - no swaps available");

    logger.debug(
      `[TX_DEBUG] sellChain=${sellSwapperChainId} buyChain=${buySwapperChainId} isCrossChain=${isCrossChain} taker=${taker} walletId=${walletId}`,
    );
    logger.debug(`[TX_DEBUG] allQuotes=${JSON.stringify(quotes)}`);

    logger.info("Signing and sending swap transaction");

    let signResult: { hash?: string; rawTransaction: string };

    if (isCrossChain) {
      const crossChainQuote = quotes[0] as CrossChainQuote;
      const step = crossChainQuote.steps?.[0];
      if (!step?.transactionData) {
        throw new Error(
          `Cross-chain quote missing transactionData in steps[0]. Quote: ${JSON.stringify(crossChainQuote)}`,
        );
      }

      if (isSellSolana) {
        // Solana → EVM: sign the Solana initiation tx from steps[0]
        const solanaStep = step as SolanaOriginCrossChainStep;
        const decoded = decodeTransactionData(
          solanaStep.transactionData,
          params.base64EncodedTx as boolean | undefined,
        );
        const encoded = base64urlEncode(decoded);
        logger.debug(`[TX_DEBUG] decodedByteLength=${decoded.length} base64urlLength=${encoded.length}`);
        signResult = await context.client.signAndSendTransaction({
          walletId,
          transaction: encoded,
          networkId: normalizeNetworkId(rawSellChain) as NetworkId,
          derivationIndex,
          account: taker,
        });
      } else {
        // EVM → Solana: build and sign the EVM initiation tx from steps[0]
        const evmStep = step as EvmOriginCrossChainStep;
        if (!evmStep.exchangeAddress) {
          throw new Error(`Cross-chain EVM step missing exchangeAddress. Step: ${JSON.stringify(evmStep)}`);
        }
        const chainId = parseInt(sellSwapperChainId.split(":")[1], 10);
        const rpcUrl = resolveEvmRpcUrl(sellSwapperChainId);
        const [nonce, gasPrice] = await Promise.all([fetchNonce(rpcUrl, taker), fetchGasPrice(rpcUrl)]);
        logger.info(
          `[TX_DEBUG] fetched nonce=${nonce} gasPrice=${gasPrice} for taker=${taker} on ${sellSwapperChainId}`,
        );
        const txValue = "0x" + BigInt(evmStep.value ?? "0").toString(16);
        const baseTx: Record<string, unknown> = {
          from: taker,
          to: evmStep.exchangeAddress,
          value: txValue,
          data: evmStep.transactionData,
          chainId,
          nonce,
          gasPrice,
        };
        const txGas = evmStep.gasCosts?.[0];
        if (txGas != null && txGas > 0) {
          baseTx.gas = "0x" + txGas.toString(16);
        } else {
          baseTx.gas = await estimateGas(rpcUrl, {
            from: taker,
            to: evmStep.exchangeAddress,
            value: txValue,
            data: evmStep.transactionData,
          });
          logger.info(`[TX_DEBUG] no gasCosts in step, estimated gas=${baseTx.gas}`);
        }
        const { parsed: rlpHex } = await parseToKmsTransaction(baseTx, sellSwapperChainId as NetworkId);
        if (!rlpHex) throw new Error("Failed to RLP-encode EVM cross-chain swap transaction");
        signResult = await context.client.signAndSendTransaction({
          walletId,
          transaction: rlpHex,
          networkId: sellSwapperChainId as NetworkId,
          derivationIndex,
          account: taker,
        });
      }
    } else if (isSellSolana) {
      // Solana same-chain swap
      const solanaQuote = quotes[0] as SolanaQuote;
      const rawTxData = solanaQuote.transactionData;
      const txData = Array.isArray(rawTxData) ? rawTxData[0] : rawTxData;
      if (!txData) {
        throw new Error(`Solana quote missing transactionData. Quote: ${JSON.stringify(solanaQuote)}`);
      }
      const decoded = decodeTransactionData(txData, params.base64EncodedTx as boolean | undefined);
      const encoded = base64urlEncode(decoded);
      logger.debug(`[TX_DEBUG] decodedByteLength=${decoded.length} base64urlLength=${encoded.length}`);
      signResult = await context.client.signAndSendTransaction({
        walletId,
        transaction: encoded,
        networkId: normalizeNetworkId(rawSellChain) as NetworkId,
        derivationIndex,
        account: taker,
      });
    } else {
      // EVM same-chain swap
      const evmQuote = quotes[0] as EvmSameChainQuote;
      const rawTxData = evmQuote.transactionData;
      const txData = Array.isArray(rawTxData) ? rawTxData[0] : rawTxData;
      if (!txData) {
        throw new Error(`EVM quote missing transactionData. Quote: ${JSON.stringify(evmQuote)}`);
      }
      if (!evmQuote.exchangeAddress) {
        throw new Error(`EVM quote missing exchangeAddress. Quote: ${JSON.stringify(evmQuote)}`);
      }
      const chainId = parseInt(sellSwapperChainId.split(":")[1], 10);
      const rpcUrl = resolveEvmRpcUrl(sellSwapperChainId);
      const [nonce, gasPrice] = await Promise.all([fetchNonce(rpcUrl, taker), fetchGasPrice(rpcUrl)]);
      logger.info(`[TX_DEBUG] fetched nonce=${nonce} gasPrice=${gasPrice} for taker=${taker} on ${sellSwapperChainId}`);
      const txValue = "0x" + BigInt(evmQuote.value ?? "0").toString(16);
      const baseTx: Record<string, unknown> = {
        from: taker,
        to: evmQuote.exchangeAddress,
        value: txValue,
        data: txData,
        chainId,
        nonce,
        gasPrice,
      };
      if (evmQuote.gas != null && evmQuote.gas > 0) {
        baseTx.gas = "0x" + evmQuote.gas.toString(16);
      } else {
        baseTx.gas = await estimateGas(rpcUrl, {
          from: taker,
          to: evmQuote.exchangeAddress,
          value: txValue,
          data: txData,
        });
        logger.info(`[TX_DEBUG] no gas in quote, estimated gas=${baseTx.gas}`);
      }
      const { parsed: rlpHex } = await parseToKmsTransaction(baseTx, sellSwapperChainId as NetworkId);
      if (!rlpHex) throw new Error("Failed to RLP-encode EVM swap transaction");
      signResult = await context.client.signAndSendTransaction({
        walletId,
        transaction: rlpHex,
        networkId: sellSwapperChainId as NetworkId,
        derivationIndex,
        account: taker,
      });
    }

    const txHash = signResult.hash ?? null;
    logger.info(`Swap executed: ${txHash ?? "no hash returned"}`);

    // For cross-chain swaps the initiation tx is on the sell chain; the buy side completes automatically.
    const explorerUrl = txHash ? getExplorerTxUrl(sellSwapperChainId, txHash) : undefined;

    return {
      quoteRequest: body,
      quoteResponse: responseJson,
      execution: {
        signature: txHash,
        rawTransaction: signResult.rawTransaction,
        explorerUrl: explorerUrl ?? null,
      },
    };
  },
};
