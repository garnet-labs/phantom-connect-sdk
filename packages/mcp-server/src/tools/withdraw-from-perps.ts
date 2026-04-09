/**
 * withdraw_from_perps tool
 *
 * Transfers USDC from the perpetuals account back to the spot wallet.
 */

import { createTool } from "./types.js";
import { createPerpsClient } from "../utils/perps.js";
import { parseOptionalNonNegativeInteger, assertPositiveDecimalString } from "../utils/params.js";

interface Params {
  amountUsdc: string;
  walletId?: string;
  derivationIndex?: number;
}

export const withdrawFromPerpsTool = createTool<Params>({
  name: "withdraw_from_perps",
  description:
    "Transfers USDC from the perpetuals account back to the spot/Hyperliquid wallet. " +
    "Only the withdrawable balance can be withdrawn (account value minus margin used by open positions). " +
    "Use get_perp_account to check the withdrawable balance before withdrawing.",
  inputSchema: {
    type: "object",
    properties: {
      derivationIndex: {
        type: "integer",
        description: "Optional derivation index (default: 0)",
        minimum: 0,
      },
      amountUsdc: {
        type: "string",
        description: 'Amount of USDC to withdraw (e.g. "50" for 50 USDC)',
      },
    },
    required: ["amountUsdc"],
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
    assertPositiveDecimalString(params.amountUsdc, "amountUsdc");

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");
    const perps = await createPerpsClient(context, walletId, derivationIndex);

    context.logger.info(`Withdrawing ${params.amountUsdc} USDC from perps account`);

    return perps.withdraw(params.amountUsdc);
  },
});
