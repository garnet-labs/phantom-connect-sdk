/**
 * portfolio_rebalance tool - Analyzes portfolio allocations and executes swaps
 * to rebalance to user-specified target percentages.
 *
 * Two-phase design:
 *   Phase 1 ("analyze"): Returns current balances with USD values and percentage allocations.
 *   Phase 2 ("execute"): Takes target allocations and performs swaps to rebalance.
 */

import type { ToolHandler, ToolContext } from "./types.js";
import { resolveNetworks, fetchPortfolioBalances, type PortfolioItem } from "../utils/portfolio.js";
import { normalizeSwapperChainId } from "../utils/network.js";
import { getSolanaAddress } from "../utils/solana.js";
import { buildTokenObject, fetchSwapQuote, executeSwap } from "../utils/swap.js";

/** Minimum SOL to reserve for transaction fees (in UI units). */
const SOL_FEE_RESERVE = 0.05;

/** CAIP-19 identifiers for native SOL (Portfolio API may return either form). */
const SOL_CAIP19S = new Set(["solana:101/nativeToken:501", "solana:101/slip44:501"]);

export interface TokenAllocation {
  symbol: string;
  name: string;
  caip19: string;
  balance: number;
  balanceBaseUnits: string;
  decimals: number;
  priceUsd: number;
  usdValue: number;
  currentPercent: number;
  isNative: boolean;
  mint: string | null;
}

export interface TargetAllocationInput {
  symbol?: string;
  caip19: string;
  targetPercent: number;
}

interface SwapPlan {
  sellSymbol: string;
  sellCaip19: string;
  buySymbol: string;
  buyCaip19: string;
  sellAmountUsd: number;
  sellAmountBaseUnits: string;
  sellDecimals: number;
  sellMint: string | null;
  sellIsNative: boolean;
  buyMint: string | null;
  buyIsNative: boolean;
}

interface SwapResultEntry {
  sellSymbol: string;
  buySymbol: string;
  sellAmountUsd: number;
  status: "success" | "error";
  signature?: string | null;
  explorerUrl?: string | null;
  error?: string;
}

/**
 * Parses a CAIP-19 identifier to extract the mint address and whether it's native.
 * Examples:
 *   "solana:101/slip44:501"  → { isNative: true, mint: null }
 *   "solana:101/token:EPjF..." → { isNative: false, mint: "EPjF..." }
 */
export function parseCaip19(caip19: string): { isNative: boolean; mint: string | null } {
  if (caip19.includes("/slip44:") || caip19.includes("/nativeToken:")) {
    return { isNative: true, mint: null };
  }
  const tokenMatch = caip19.match(/\/(?:token|address):(.+)$/);
  if (tokenMatch) {
    return { isNative: false, mint: tokenMatch[1] };
  }
  return { isNative: false, mint: null };
}

/**
 * Builds token allocations from portfolio API response.
 * Filters out spam tokens and tokens without prices.
 */
export function buildAllocations(items: PortfolioItem[]): TokenAllocation[] {
  const tokens: TokenAllocation[] = [];
  for (const item of items) {
    if (item.spamStatus !== "VERIFIED") continue;
    if (!item.price?.price) continue;
    if (item.totalQuantity <= 0) continue;

    const { isNative, mint } = parseCaip19(item.caip19);
    const humanBalance = item.totalQuantity / 10 ** item.decimals;
    const usdValue = humanBalance * item.price.price;

    tokens.push({
      symbol: item.symbol,
      name: item.name,
      caip19: item.caip19,
      balance: humanBalance,
      balanceBaseUnits: item.totalQuantityString,
      decimals: item.decimals,
      priceUsd: item.price.price,
      usdValue,
      currentPercent: 0, // computed after totaling
      isNative,
      mint,
    });
  }

  const totalUsd = tokens.reduce((sum, t) => sum + t.usdValue, 0);
  for (const token of tokens) {
    token.currentPercent = totalUsd > 0 ? (token.usdValue / totalUsd) * 100 : 0;
  }

  // Sort by USD value descending
  tokens.sort((a, b) => b.usdValue - a.usdValue);

  return tokens;
}

/**
 * Greedy pairing algorithm: matches over-allocated tokens with under-allocated tokens
 * to produce direct swap pairs.
 */
export function computeSwapPlan(
  tokens: TokenAllocation[],
  targetAllocations: TargetAllocationInput[],
  minTradeUsd: number,
): SwapPlan[] {
  const totalUsd = tokens.reduce((sum, t) => sum + t.usdValue, 0);
  if (totalUsd <= 0) return [];

  const targetMap = new Map(targetAllocations.map(t => [t.caip19, t.targetPercent]));

  // Compute deltas
  interface DeltaEntry {
    token: TokenAllocation;
    deltaUsd: number;
  }

  const sellers: DeltaEntry[] = []; // over-allocated (need to sell)
  const buyers: DeltaEntry[] = []; // under-allocated (need to buy)

  for (const token of tokens) {
    const caip19 = token.caip19;
    const targetPercent = targetMap.get(caip19) ?? 0;

    const targetUsd = totalUsd * (targetPercent / 100);
    let deltaUsd = targetUsd - token.usdValue;

    // If selling SOL, reserve some for fees
    if (SOL_CAIP19S.has(caip19) && deltaUsd < 0) {
      const reserveUsd = SOL_FEE_RESERVE * token.priceUsd;
      const maxSellUsd = Math.max(0, token.usdValue - reserveUsd - targetUsd);
      deltaUsd = -Math.min(Math.abs(deltaUsd), maxSellUsd);
    }

    if (deltaUsd < -minTradeUsd) {
      sellers.push({ token, deltaUsd }); // deltaUsd is negative
    } else if (deltaUsd > minTradeUsd) {
      buyers.push({ token, deltaUsd }); // deltaUsd is positive
    }
  }

  // Sort by magnitude descending
  sellers.sort((a, b) => a.deltaUsd - b.deltaUsd); // most negative first
  buyers.sort((a, b) => b.deltaUsd - a.deltaUsd); // most positive first

  const swaps: SwapPlan[] = [];
  let si = 0;
  let bi = 0;

  while (si < sellers.length && bi < buyers.length) {
    const seller = sellers[si];
    const buyer = buyers[bi];

    const matchUsd = Math.min(Math.abs(seller.deltaUsd), buyer.deltaUsd);

    if (matchUsd < minTradeUsd) {
      // Both remaining deltas are below threshold
      si++;
      bi++;
      continue;
    }

    // Convert USD amount to base units of the sell token
    const sellAmountUi = matchUsd / seller.token.priceUsd;
    const sellAmountBaseUnits = BigInt(Math.floor(sellAmountUi * 10 ** seller.token.decimals)).toString();

    swaps.push({
      sellSymbol: seller.token.symbol,
      sellCaip19: seller.token.caip19,
      buySymbol: buyer.token.symbol,
      buyCaip19: buyer.token.caip19,
      sellAmountUsd: matchUsd,
      sellAmountBaseUnits,
      sellDecimals: seller.token.decimals,
      sellMint: seller.token.mint,
      sellIsNative: seller.token.isNative,
      buyMint: buyer.token.mint,
      buyIsNative: buyer.token.isNative,
    });

    // Reduce deltas
    seller.deltaUsd += matchUsd; // moves toward 0
    buyer.deltaUsd -= matchUsd; // moves toward 0

    if (Math.abs(seller.deltaUsd) < minTradeUsd) si++;
    if (buyer.deltaUsd < minTradeUsd) bi++;
  }

  return swaps;
}

export const portfolioRebalanceTool: ToolHandler = {
  name: "portfolio_rebalance",
  description:
    "Phantom Wallet — Analyzes your portfolio allocation and rebalances it to target percentages via token swaps. " +
    "Two-phase flow: (1) Call with phase 'analyze' to see current token balances, USD values, and allocation percentages. " +
    "(2) After the user specifies desired target percentages, call with phase 'execute' and targetAllocations to compute and perform the swaps. " +
    "Use dryRun: true in the execute phase to preview the swap plan without executing. " +
    "Currently supports Solana network only. Percentages in targetAllocations must sum to 100. " +
    "The tool uses direct token-to-token swaps via Phantom's routing engine for optimal execution.",
  inputSchema: {
    type: "object",
    properties: {
      phase: {
        type: "string",
        enum: ["analyze", "execute"],
        description:
          "'analyze' returns current portfolio with allocations. " +
          "'execute' takes target allocations and performs swaps to rebalance.",
      },
      network: {
        type: "string",
        enum: ["solana"],
        description: "Network to rebalance on. Currently only 'solana' is supported. Default: 'solana'.",
      },
      targetAllocations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            symbol: {
              type: "string",
              description: "Token symbol (informational, for readability).",
            },
            caip19: {
              type: "string",
              description:
                "CAIP-19 identifier for the token, from the analyze phase response. " +
                "Example: 'solana:101/slip44:501' for SOL, 'solana:101/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' for USDC.",
            },
            targetPercent: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Target allocation percentage for this token.",
            },
          },
          required: ["caip19", "targetPercent"],
        },
        description:
          "Required for 'execute' phase. Array of tokens with target percentage allocations. " +
          "Percentages must sum to 100. Use caip19 identifiers from the 'analyze' phase response.",
      },
      slippageTolerance: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "Slippage tolerance in percent for each swap (default: 1).",
      },
      minTradeUsd: {
        type: "number",
        minimum: 0,
        description:
          "Minimum USD value for a trade to be worth executing (default: 1.0). " +
          "Trades below this threshold are skipped to avoid dust.",
      },
      dryRun: {
        type: "boolean",
        description:
          "If true during 'execute' phase, calculate and return the swap plan without executing. Default: false.",
      },
    },
    required: ["phase"],
  },
  annotations: {
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params: Record<string, unknown>, context: ToolContext) => {
    const { session, logger } = context;
    const phase = params.phase as string;
    const network = typeof params.network === "string" ? params.network : "solana";

    if (network !== "solana") {
      throw new Error("Only 'solana' network is currently supported for portfolio rebalancing.");
    }

    const networks = resolveNetworks([network]);

    // --- Analyze phase ---
    if (phase === "analyze") {
      const portfolio = await fetchPortfolioBalances(context, networks);
      const allocations = buildAllocations(portfolio.items);
      const totalUsd = allocations.reduce((sum, t) => sum + t.usdValue, 0);

      return {
        phase: "analyze",
        network,
        totalUsdValue: Math.round(totalUsd * 100) / 100,
        tokens: allocations.map(t => ({
          symbol: t.symbol,
          name: t.name,
          caip19: t.caip19,
          balance: t.balance,
          balanceBaseUnits: t.balanceBaseUnits,
          decimals: t.decimals,
          priceUsd: t.priceUsd,
          usdValue: Math.round(t.usdValue * 100) / 100,
          currentPercent: Math.round(t.currentPercent * 100) / 100,
          isNative: t.isNative,
          mint: t.mint,
        })),
      };
    }

    // --- Execute phase ---
    if (phase !== "execute") {
      throw new Error(`Invalid phase: '${phase}'. Must be 'analyze' or 'execute'.`);
    }

    if (!Array.isArray(params.targetAllocations) || params.targetAllocations.length === 0) {
      throw new Error("targetAllocations is required for the execute phase and must be a non-empty array.");
    }

    const targetAllocations = params.targetAllocations as TargetAllocationInput[];

    // Validate percentages sum to 100
    const totalPercent = targetAllocations.reduce((sum, t) => sum + t.targetPercent, 0);
    if (Math.abs(totalPercent - 100) > 0.01) {
      throw new Error(
        `Target allocations must sum to 100%, but got ${totalPercent.toFixed(2)}%. ` +
          `Please adjust your allocations.`,
      );
    }

    // Validate each allocation
    const seenCaip19 = new Set<string>();
    for (const alloc of targetAllocations) {
      if (!alloc.caip19 || typeof alloc.caip19 !== "string") {
        throw new Error("Each target allocation must have a 'caip19' string identifier.");
      }
      if (seenCaip19.has(alloc.caip19)) {
        throw new Error(`Duplicate target allocation for ${alloc.caip19}.`);
      }
      seenCaip19.add(alloc.caip19);
      if (typeof alloc.targetPercent !== "number" || alloc.targetPercent < 0 || alloc.targetPercent > 100) {
        throw new Error(`Invalid targetPercent for ${alloc.caip19}: must be between 0 and 100.`);
      }
    }

    const minTradeUsd = typeof params.minTradeUsd === "number" ? params.minTradeUsd : 1.0;
    const slippageTolerance = typeof params.slippageTolerance === "number" ? params.slippageTolerance : 1;
    const dryRun = typeof params.dryRun === "boolean" ? params.dryRun : false;

    // Re-fetch balances for fresh prices
    logger.info("Fetching fresh portfolio balances for rebalance execution");
    const portfolio = await fetchPortfolioBalances(context, networks);
    const allocations = buildAllocations(portfolio.items);
    const totalUsd = allocations.reduce((sum, t) => sum + t.usdValue, 0);

    // Validate all target caip19s exist in portfolio
    const knownCaip19s = new Set(allocations.map(t => t.caip19));
    for (const alloc of targetAllocations) {
      if (!knownCaip19s.has(alloc.caip19)) {
        throw new Error(
          `Token with caip19 '${alloc.caip19}' not found in current portfolio. ` +
            `Available tokens: ${allocations.map(t => `${t.symbol} (${t.caip19})`).join(", ")}`,
        );
      }
    }

    // Compute swap plan
    const swapPlan = computeSwapPlan(allocations, targetAllocations, minTradeUsd);

    if (swapPlan.length === 0) {
      return {
        phase: "execute",
        network,
        totalUsdValue: Math.round(totalUsd * 100) / 100,
        message: "Portfolio is already within tolerance of target allocations. No swaps needed.",
        swaps: [],
        errors: [],
      };
    }

    if (dryRun) {
      return {
        phase: "execute",
        dryRun: true,
        network,
        totalUsdValue: Math.round(totalUsd * 100) / 100,
        plannedSwaps: swapPlan.map(s => ({
          sell: s.sellSymbol,
          buy: s.buySymbol,
          sellAmountUsd: Math.round(s.sellAmountUsd * 100) / 100,
          sellAmountBaseUnits: s.sellAmountBaseUnits,
        })),
        message: "Dry run complete. Set dryRun: false to execute these swaps.",
      };
    }

    // Execute swaps
    const walletId = session.walletId;
    const sellChainId = normalizeSwapperChainId("solana:mainnet");
    const solanaAddress = await getSolanaAddress(context, walletId, undefined);

    const results: SwapResultEntry[] = [];
    const errors: string[] = [];

    for (const swap of swapPlan) {
      logger.info(`Executing swap: ${swap.sellSymbol} → ${swap.buySymbol} (~$${swap.sellAmountUsd.toFixed(2)})`);

      try {
        const sellToken = buildTokenObject(sellChainId, swap.sellMint ?? undefined, swap.sellIsNative);
        const buyToken = buildTokenObject(sellChainId, swap.buyMint ?? undefined, swap.buyIsNative);

        const { quoteResponse } = await fetchSwapQuote({
          sellChainId,
          buyChainId: sellChainId,
          sellToken,
          buyToken,
          taker: solanaAddress,
          sellAmount: swap.sellAmountBaseUnits,
          slippageTolerance,
          autoSlippage: true,
          apiClient: context.apiClient,
          logger,
        });

        const swapResult = await executeSwap({
          quoteResponse,
          sellChainId,
          buyChainId: sellChainId,
          rawSellChain: "solana:mainnet",
          taker: solanaAddress,
          walletId,
          client: context.client,
          logger,
        });

        results.push({
          sellSymbol: swap.sellSymbol,
          buySymbol: swap.buySymbol,
          sellAmountUsd: Math.round(swap.sellAmountUsd * 100) / 100,
          status: "success",
          signature: swapResult.signature,
          explorerUrl: swapResult.explorerUrl,
        });

        logger.info(`Swap ${swap.sellSymbol} → ${swap.buySymbol} succeeded: ${swapResult.signature}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Swap ${swap.sellSymbol} → ${swap.buySymbol} failed: ${errorMsg}`);
        errors.push(`${swap.sellSymbol} → ${swap.buySymbol}: ${errorMsg}`);
        results.push({
          sellSymbol: swap.sellSymbol,
          buySymbol: swap.buySymbol,
          sellAmountUsd: Math.round(swap.sellAmountUsd * 100) / 100,
          status: "error",
          error: errorMsg,
        });
      }
    }

    return {
      phase: "execute",
      network,
      totalUsdValue: Math.round(totalUsd * 100) / 100,
      swaps: results,
      errors,
    };
  },
};
