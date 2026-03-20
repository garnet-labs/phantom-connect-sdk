/**
 * update_perp_leverage tool
 *
 * Updates leverage and margin type for a perpetual market on Hyperliquid.
 */

import { createTool } from "./types.js";
import { createPerpsClient } from "../utils/perps.js";
import { parseOptionalNonNegativeInteger, assertFiniteNumberAtLeast } from "../utils/params.js";

interface Params {
  market: string;
  leverage: number;
  marginType: "cross" | "isolated";
  walletId?: string;
  derivationIndex?: number;
}

export const updatePerpLeverageTool = createTool<Params>({
  name: "update_perp_leverage",
  description:
    "Updates the leverage and margin type (cross or isolated) for a perpetual market. " +
    "This takes effect for new orders on that market. Cross margin shares account balance across positions; " +
    "isolated margin limits risk to the margin allocated to that position.",
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
        description: 'Market symbol (e.g. "BTC")',
      },
      leverage: {
        type: "number",
        description: "Leverage multiplier (e.g. 1 for 1x, 10 for 10x)",
        minimum: 1,
      },
      marginType: {
        type: "string",
        enum: ["cross", "isolated"],
        description: "Margin type: 'cross' shares balance, 'isolated' caps risk per-position",
      },
    },
    required: ["market", "leverage", "marginType"],
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
    assertFiniteNumberAtLeast(params.leverage, "leverage", 1);
    if (params.marginType !== "cross" && params.marginType !== "isolated") {
      throw new Error("marginType must be 'cross' or 'isolated'");
    }

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");
    const perps = await createPerpsClient(context, walletId, derivationIndex);

    context.logger.info(`Updating ${params.market} leverage to ${params.leverage}x ${params.marginType}`);

    return perps.updateLeverage({
      market: params.market,
      leverage: params.leverage,
      marginType: params.marginType,
    });
  },
});
