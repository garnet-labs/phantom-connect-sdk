/**
 * cancel_perp_order tool
 *
 * Cancels an open perpetual order on Hyperliquid.
 */

import { createTool } from "./types.js";
import { createPerpsClient } from "../utils/perps.js";
import { parseOptionalNonNegativeInteger, assertSafeInteger } from "../utils/params.js";

interface Params {
  market: string;
  orderId: number;
  walletId?: string;
  derivationIndex?: number;
}

export const cancelPerpOrderTool = createTool<Params>({
  name: "cancel_perp_order",
  description:
    "Cancels an open perpetual order on Hyperliquid. Use get_perp_orders to retrieve the order ID before cancelling.",
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
      orderId: {
        type: "integer",
        description: "The numeric order ID to cancel (from get_perp_orders)",
      },
    },
    required: ["market", "orderId"],
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
    assertSafeInteger(params.orderId, "orderId");

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");
    const perps = await createPerpsClient(context, walletId, derivationIndex);

    context.logger.info(`Cancelling perp order ${params.orderId} on ${params.market}`);

    return perps.cancelOrder({
      market: params.market,
      orderId: params.orderId,
    });
  },
});
