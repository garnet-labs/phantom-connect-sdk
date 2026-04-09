/**
 * sign_evm_personal_message tool
 *
 * Signs a personal message using EIP-191 (eth_sign / personal_sign) with
 * the authenticated EVM embedded wallet.
 * Mirrors sdk.ethereum.signPersonalMessage(message, address) from the browser-sdk.
 */

import type { NetworkId } from "@phantom/client";
import { isEthereumChain } from "@phantom/utils";
import { chainIdToNetworkId } from "@phantom/constants";
import { stringToBase64url } from "@phantom/base64url";
import type { ToolHandler, ToolContext } from "./types.js";
import { parseChainId, parseOptionalNonNegativeInteger } from "../utils/params.js";

export const signEvmPersonalMessageTool: ToolHandler = {
  name: "sign_evm_personal_message",
  description:
    "Signs a UTF-8 message using EIP-191 personal_sign with the authenticated EVM embedded wallet. " +
    "Use this for authentication challenges, proof-of-ownership flows, or any off-chain EVM signature request. " +
    "Returns a hex-encoded signature. Use the chainId number directly (e.g. 1 for Ethereum, 8453 for Base, 137 for Polygon, 42161 for Arbitrum, 143 for Monad). " +
    "For Solana message signing use sign_solana_message instead. " +
    "Success response: {signature: string}.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The UTF-8 message to sign",
      },
      chainId: {
        type: ["number", "string"],
        description:
          "EVM chain ID (e.g. 1 for Ethereum mainnet, 8453 for Base, 137 for Polygon, 42161 for Arbitrum, 143 for Monad). Matches the chainId field from DeFi aggregators.",
      },
      derivationIndex: {
        type: "integer",
        description: "Optional derivation index for the account (default: 0)",
        minimum: 0,
      },
    },
    required: ["message", "chainId"],
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

    const chainId = parseChainId(params.chainId);
    const networkId = chainIdToNetworkId(chainId) as NetworkId | undefined;
    if (!networkId || !isEthereumChain(networkId)) {
      throw new Error(
        `Unsupported chainId: ${chainId}. Use a supported EVM chain ID (e.g. 1 for Ethereum, 8453 for Base, 137 for Polygon, 42161 for Arbitrum, 143 for Monad).`,
      );
    }

    const walletId = typeof params.walletId === "string" ? params.walletId : session.walletId;
    if (!walletId) {
      throw new Error("walletId is required (missing from session and not provided)");
    }

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");

    // Convert UTF-8 message to base64url (what PhantomClient KMS expects for EIP-191)
    const base64Message = stringToBase64url(params.message);

    logger.info(`Signing EVM personal message for wallet ${walletId} on ${networkId}`);

    try {
      const signature = await client.ethereumSignMessage({
        walletId,
        message: base64Message,
        networkId,
        derivationIndex,
      });

      logger.info(`EVM personal message signed successfully`);

      return { signature };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to sign EVM personal message: ${errorMessage}`);
      throw new Error(`Failed to sign EVM personal message: ${errorMessage}`);
    }
  },
};
