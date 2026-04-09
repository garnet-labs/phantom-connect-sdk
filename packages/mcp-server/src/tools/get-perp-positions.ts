/**
 * get_perp_positions tool
 *
 * Returns open perpetual positions for the authenticated wallet.
 */

import { createTool } from "./types.js";
import { createPerpsClient } from "../utils/perps.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";

interface Params {
  walletId?: string;
  derivationIndex?: number;
}

export const getPerpPositionsTool = createTool<Params>({
  name: "get_perp_positions",
  description:
    "Returns all open perpetual positions for the wallet. Each position includes coin, direction (long/short), size, margin, entry price, leverage, unrealized PnL, and liquidation price.",
  inputSchema: {
    type: "object",
    properties: {
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
    return perps.getPositions();
  },
});
