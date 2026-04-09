/**
 * get_perp_markets tool
 *
 * Returns all available perpetual markets on Hyperliquid with current prices,
 * funding rates, and market metadata.
 */

import { createTool } from "./types.js";
import { createPerpsClient, createAnonymousPerpsClient } from "../utils/perps.js";

interface Params {
  walletId?: string;
}

export const getPerpMarketsTool = createTool<Params>({
  name: "get_perp_markets",
  description:
    "Returns all available perpetual markets on Hyperliquid with current prices, funding rates, open interest, 24h volume, max leverage, and asset IDs. Use this to discover tradeable markets and get current prices before opening positions.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
  handler: async (params, context) => {
    const walletId = params.walletId ?? context.session.walletId;
    const perps = walletId ? await createPerpsClient(context, walletId) : createAnonymousPerpsClient(context);
    return perps.getMarkets();
  },
});
