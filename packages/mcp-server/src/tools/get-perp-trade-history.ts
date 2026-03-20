/**
 * get_perp_trade_history tool
 *
 * Returns trade history for the authenticated wallet's perpetuals account.
 */

import { createTool } from "./types.js";
import { createPerpsClient } from "../utils/perps.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";

interface Params {
  walletId?: string;
  derivationIndex?: number;
}

export const getPerpTradeHistoryTool = createTool<Params>({
  name: "get_perp_trade_history",
  description:
    "Returns historical perpetual trades for the wallet. Each entry includes trade ID, coin, type (open/close/liquidation), timestamp, price, size, trade value, fee, and closed PnL.",
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
    return perps.getTradeHistory();
  },
});
