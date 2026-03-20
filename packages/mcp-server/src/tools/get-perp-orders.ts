/**
 * get_perp_orders tool
 *
 * Returns open perpetual orders for the authenticated wallet.
 */

import { createTool } from "./types.js";
import { createPerpsClient } from "../utils/perps.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";

interface Params {
  walletId?: string;
  derivationIndex?: number;
}

export const getPerpOrdersTool = createTool<Params>({
  name: "get_perp_orders",
  description:
    "Returns all open perpetual orders (limit orders, take-profit, stop-loss) for the wallet. Each order includes ID, coin, side, type, limit/trigger price, size, and whether it is reduce-only.",
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
    },
    required: [],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  handler: async (params, context) => {
    const walletId = params.walletId ?? context.session.walletId;
    if (!walletId) {
      throw new Error("walletId is required");
    }
    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");

    const perps = await createPerpsClient(context, walletId, derivationIndex);
    return perps.getOpenOrders();
  },
});
