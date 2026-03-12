/**
 * sign_solana_message tool
 *
 * Signs a UTF-8 message with the authenticated Solana wallet.
 * Mirrors sdk.solana.signMessage(message) from the browser-sdk.
 */

import type { NetworkId } from "@phantom/client";
import { isSolanaChain } from "@phantom/utils";
import type { ToolHandler, ToolContext } from "./types.js";
import { normalizeNetworkId } from "../utils/network.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";

export const signSolanaMessageTool: ToolHandler = {
  name: "sign_solana_message",
  description:
    "Signs a UTF-8 message using the authenticated Solana embedded wallet. Returns a base58-encoded signature. Use this for off-chain signature proofs, authentication challenges, and message attestation on Solana.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The UTF-8 message to sign",
      },
      networkId: {
        type: "string",
        description: 'Solana network identifier (e.g., "solana:mainnet", "solana:devnet")',
      },
      walletId: {
        type: "string",
        description: "Optional wallet ID to use for signing (defaults to authenticated wallet)",
      },
      derivationIndex: {
        type: "integer",
        description: "Optional derivation index for the account (default: 0)",
        minimum: 0,
      },
    },
    required: ["message", "networkId"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  handler: async (params: Record<string, unknown>, context: ToolContext) => {
    const { client, session, logger } = context;

    if (typeof params.message !== "string") {
      throw new Error("message must be a string");
    }
    if (typeof params.networkId !== "string") {
      throw new Error("networkId must be a string");
    }

    const networkId = normalizeNetworkId(params.networkId) as NetworkId;
    if (!isSolanaChain(networkId)) {
      throw new Error(
        "sign_solana_message supports Solana networks only. For EVM message signing use sign_evm_personal_message.",
      );
    }

    const walletId = typeof params.walletId === "string" ? params.walletId : session.walletId;
    if (!walletId) {
      throw new Error("walletId is required (missing from session and not provided)");
    }

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");

    logger.info(`Signing Solana message for wallet ${walletId} on ${networkId}`);

    try {
      const signature = await client.signUtf8Message({
        walletId,
        message: params.message,
        networkId,
        derivationIndex,
      });

      logger.info(`Solana message signed successfully`);

      return { signature };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to sign Solana message: ${errorMessage}`);
      throw new Error(`Failed to sign Solana message: ${errorMessage}`);
    }
  },
};
