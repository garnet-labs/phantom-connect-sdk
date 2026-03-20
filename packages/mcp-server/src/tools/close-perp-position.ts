/**
 * close_perp_position tool
 *
 * Closes an existing perpetual position on Hyperliquid.
 */

import { createTool } from "./types.js";
import { createPerpsClient } from "../utils/perps.js";
import { parseOptionalNonNegativeInteger, assertFiniteNumberInRange } from "../utils/params.js";

interface Params {
  market: string;
  sizePercent?: number;
  walletId?: string;
  derivationIndex?: number;
}

export const closePerpPositionTool = createTool<Params>({
  name: "close_perp_position",
  description:
    "Closes an open perpetual position on Hyperliquid. By default closes 100% of the position. " +
    "Use sizePercent to partially close (e.g. 50 to close half). " +
    "Uses a market IOC order with 10% slippage buffer.",
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
        description: 'Market symbol of the position to close (e.g. "BTC")',
      },
      sizePercent: {
        type: "number",
        description: "Percentage of position to close (0-100, default: 100 for full close)",
        minimum: 1,
        maximum: 100,
      },
    },
    required: ["market"],
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
    if (!params.market?.trim()) {
      throw new Error("market is required");
    }
    if (params.sizePercent !== undefined) {
      assertFiniteNumberInRange(params.sizePercent, "sizePercent", 1, 100);
    }

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");
    const perps = await createPerpsClient(context, walletId, derivationIndex);

    context.logger.info(`Closing ${params.sizePercent ?? 100}% of ${params.market} perp position`);

    return perps.closePosition({
      market: params.market,
      sizePercent: params.sizePercent,
    });
  },
});
