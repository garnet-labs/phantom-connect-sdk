/**
 * open_perp_position tool
 *
 * Opens a perpetual position on Hyperliquid via Phantom backend.
 */

import { createTool } from "./types.js";
import { createPerpsClient } from "../utils/perps.js";
import {
  parseOptionalNonNegativeInteger,
  assertFiniteNumberAtLeast,
  assertPositiveFiniteNumber,
} from "../utils/params.js";

interface Params {
  market: string;
  direction: "long" | "short";
  /** Accepts string or number — normalised to string before passing to perps client. */
  sizeUsd: string | number;
  leverage: number;
  orderType: "market" | "limit";
  /** Accepts string or number for convenience — normalised to string for limit orders. */
  limitPrice?: string | number;
  marginType?: "isolated" | "cross";
  reduceOnly?: boolean;
  walletId?: string;
  derivationIndex?: number;
}

export const openPerpPositionTool = createTool<Params>({
  name: "open_perp_position",
  description:
    "Opens a perpetual position on Hyperliquid. Supports market and limit orders in either long or short direction. " +
    "The position size is specified in USD. For market orders, a 10% slippage buffer is applied automatically. " +
    "Use get_perp_markets first to verify the market symbol and current price. " +
    "Requires the wallet to have USDC deposited in the perps account (use deposit_to_perps if needed).",
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
      market: {
        type: "string",
        description: 'Market symbol (e.g. "BTC", "ETH", "SOL")',
      },
      direction: {
        type: "string",
        enum: ["long", "short"],
        description: "Position direction",
      },
      sizeUsd: {
        type: "string",
        description: 'Position size in USD (e.g. "100" for $100 notional value)',
      },
      leverage: {
        type: "number",
        description: "Leverage multiplier (e.g. 1 for 1x, 10 for 10x)",
        minimum: 1,
      },
      orderType: {
        type: "string",
        enum: ["market", "limit"],
        description: "Order type. Market orders execute immediately; limit orders rest on the book",
      },
      limitPrice: {
        type: "string",
        description: 'Required for limit orders: the limit price as a string (e.g. "50000")',
      },
      marginType: {
        type: "string",
        enum: ["isolated", "cross"],
        description: "Margin type: 'isolated' (default) limits risk to this position; 'cross' shares account balance",
      },
      reduceOnly: {
        type: "boolean",
        description: "If true, the order can only reduce an existing position (default: false)",
      },
    },
    required: ["market", "direction", "sizeUsd", "leverage", "orderType"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params, context) => {
    const walletId = params.walletId ?? context.session.walletId;
    if (!walletId) {
      throw new Error("walletId is required");
    }
    if (!params.market) {
      throw new Error("market is required");
    }
    if (params.direction !== "long" && params.direction !== "short") {
      throw new Error("direction must be 'long' or 'short'");
    }
    if (params.orderType !== "market" && params.orderType !== "limit") {
      throw new Error("orderType must be 'market' or 'limit'");
    }
    assertFiniteNumberAtLeast(params.leverage, "leverage", 1);

    const sizeUsdNum = typeof params.sizeUsd === "number" ? params.sizeUsd : parseFloat(params.sizeUsd);
    assertPositiveFiniteNumber(sizeUsdNum, "sizeUsd");

    if (params.orderType === "limit") {
      const limitPriceStr = params.limitPrice !== undefined ? String(params.limitPrice) : "";
      assertPositiveFiniteNumber(parseFloat(limitPriceStr), "limitPrice");
    }

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");
    const perps = await createPerpsClient(context, walletId, derivationIndex);

    context.logger.info(
      `Opening ${params.direction} perp position on ${params.market} for $${params.sizeUsd} at ${params.leverage}x leverage`,
    );

    return perps.openPosition({
      market: params.market,
      direction: params.direction,
      sizeUsd: String(params.sizeUsd),
      leverage: params.leverage,
      marginType: params.marginType === "cross" ? "cross" : "isolated",
      orderType: params.orderType,
      limitPrice: params.limitPrice !== undefined ? String(params.limitPrice) : undefined,
      reduceOnly: params.reduceOnly ?? false,
    });
  },
});
