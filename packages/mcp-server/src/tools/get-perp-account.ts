/**
 * get_perp_account tool
 *
 * Returns the perpetuals account balance for the authenticated wallet.
 */

import { createTool } from "./types.js";
import { createPerpsClient } from "../utils/perps.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";

interface Params {
  walletId?: string;
  derivationIndex?: number;
}

export const getPerpAccountTool = createTool<Params>({
  name: "get_perp_account",
  description:
    "Returns the perpetuals account balance including total account value, available balance, and withdrawable amount. The account is on Hyperliquid (funded with USDC).",
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
    return perps.getBalance();
  },
});
