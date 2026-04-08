/**
 * withdraw_from_hyperliquid_spot tool
 *
 * Bridges USDC from the Hyperliquid spot wallet to an external chain via the Relay V2 bridge.
 * Delegates all signing and submission logic to PerpsClient.withdrawFromSpot().
 *
 * Note: funds must be in the spot account before calling this tool.
 * Use withdraw_from_perps first if funds are in the perp account.
 */

import { createTool } from "./types.js";
import { createPerpsClient } from "../utils/perps.js";
import { getEthereumAddress } from "../utils/evm.js";
import { getSolanaAddress } from "../utils/solana.js";
import { isSolanaChain } from "@phantom/utils";
import { normalizeSwapperChainId } from "../utils/network.js";
import { parseOptionalNonNegativeInteger, assertPositiveDecimalString } from "../utils/params.js";

interface Params {
  amountUsdc: string;
  destinationChainId: string;
  buyToken?: string;
  execute?: boolean;
  walletId?: string;
  derivationIndex?: number;
}

export const withdrawFromHyperliquidSpotTool = createTool<Params>({
  name: "withdraw_from_hyperliquid_spot",
  description:
    "Bridges USDC from the Hyperliquid spot wallet to an external chain (Solana, Base, Ethereum, Arbitrum, Polygon) " +
    "via the Relay bridge. Funds must be in the Hyperliquid spot account — use withdraw_from_perps first if they " +
    "are in the perp account. " +
    "By default receives USDC on the destination chain; pass buyToken to receive a different asset. " +
    "Use execute: false (default) to preview the quote first.",
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
      amountUsdc: {
        type: "string",
        description: 'Amount of USDC to bridge out (e.g. "8.0" for 8 USDC)',
      },
      destinationChainId: {
        type: "string",
        description:
          'Destination chain CAIP-2 ID. Examples: "solana:mainnet", "eip155:8453" (Base), ' +
          '"eip155:1" (Ethereum), "eip155:42161" (Arbitrum), "eip155:137" (Polygon).',
      },
      buyToken: {
        type: "string",
        description:
          'CAIP-19 token to receive on the destination chain (e.g. "solana:101/address:EPjFWdd5..."). ' +
          "Defaults to USDC on the destination chain if omitted.",
      },
      execute: {
        type: "boolean",
        description: "If false (default), returns the quote only. If true, signs and broadcasts immediately.",
      },
    },
    required: ["amountUsdc", "destinationChainId"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params, context) => {
    const { session, logger } = context;

    const walletId = params.walletId ?? session.walletId;
    if (!walletId) throw new Error("walletId is required");

    assertPositiveDecimalString(params.amountUsdc, "amountUsdc");
    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");
    const execute = params.execute ?? false;

    const normalizedDestChain = normalizeSwapperChainId(params.destinationChainId);
    const isSolanaDestination = isSolanaChain(normalizedDestChain);

    const destinationAddress = isSolanaDestination
      ? await getSolanaAddress(context, walletId, derivationIndex)
      : await getEthereumAddress(context, walletId, derivationIndex);

    const perps = await createPerpsClient(context, walletId, derivationIndex);

    const withdrawParams = {
      amountUsdc: params.amountUsdc,
      destinationChainId: normalizedDestChain,
      destinationAddress,
      buyToken: params.buyToken,
    };

    if (!execute) {
      logger.info("withdraw_from_hyperliquid_spot: returning quote only (execute: false)");
      const quote = await perps.getWithdrawFromSpotQuote(withdrawParams);
      return { quote };
    }

    return perps.withdrawFromSpot(withdrawParams);
  },
});
