/**
 * sign_evm_typed_data tool
 *
 * Signs EIP-712 typed structured data with the authenticated EVM embedded wallet.
 * Mirrors sdk.ethereum.signTypedData(typedData, address) from the browser-sdk.
 *
 * This is the standard interface used by DeFi protocols for permit signatures,
 * order signing, and other off-chain approvals.
 */

import type { NetworkId } from "@phantom/client";
import { isEthereumChain } from "@phantom/utils";
import { validateEip712TypedData } from "@phantom/parsers";
import { chainIdToNetworkId } from "@phantom/constants";
import type { ToolHandler, ToolContext } from "./types.js";
import { parseChainId, parseOptionalNonNegativeInteger } from "../utils/params.js";

export const signEvmTypedDataTool: ToolHandler = {
  name: "sign_evm_typed_data",
  description:
    "Signs EIP-712 typed structured data using the authenticated EVM embedded wallet. Returns a hex-encoded signature. Used for DeFi permit signatures, order signing (e.g. 0x, Seaport), and other structured off-chain approvals. The typedData parameter must follow the EIP-712 structure with types, primaryType, domain, and message fields. Use the chainId number directly (e.g. 1 for Ethereum, 8453 for Base, 137 for Polygon, 42161 for Arbitrum, 143 for Monad).",
  inputSchema: {
    type: "object",
    properties: {
      typedData: {
        type: "object",
        description:
          "EIP-712 typed data object. Must contain: types (object), primaryType (string), domain (object), message (object). See https://eips.ethereum.org/EIPS/eip-712 for the full specification.",
        properties: {
          types: {
            type: "object",
            description: "Type definitions mapping type names to arrays of {name, type} fields",
          },
          primaryType: {
            type: "string",
            description: "The primary type name to sign (must be a key in types)",
          },
          domain: {
            type: "object",
            description: "EIP-712 domain separator values (e.g. name, version, chainId, verifyingContract)",
          },
          message: {
            type: "object",
            description: "The structured data to sign, conforming to primaryType",
          },
        },
        required: ["types", "primaryType", "domain", "message"],
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
    required: ["typedData", "chainId"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  handler: async (params: Record<string, unknown>, context: ToolContext) => {
    const { client, session, logger } = context;

    const chainId = parseChainId(params.chainId);
    const networkId = chainIdToNetworkId(chainId) as NetworkId | undefined;
    if (!networkId || !isEthereumChain(networkId)) {
      throw new Error(
        `Unsupported chainId: ${chainId}. Use a supported EVM chain ID (e.g. 1 for Ethereum, 8453 for Base, 137 for Polygon, 42161 for Arbitrum, 143 for Monad).`,
      );
    }

    // Validate typedData structure (throws with a descriptive error if invalid)
    validateEip712TypedData(params.typedData);
    const typedData = params.typedData;

    // Reject domain.chainId that contradicts the provided chainId
    const domainChainIdRaw = (typedData.domain as Record<string, unknown>).chainId;
    if (domainChainIdRaw !== undefined) {
      const domainChainId =
        typeof domainChainIdRaw === "number"
          ? domainChainIdRaw
          : typeof domainChainIdRaw === "string"
            ? parseInt(domainChainIdRaw, 10)
            : NaN;
      if (isNaN(domainChainId) || domainChainId !== chainId) {
        throw new Error(
          `typedData.domain.chainId (${domainChainIdRaw}) does not match the provided chainId (${chainId}). ` +
            `Ensure typedData and chainId refer to the same chain.`,
        );
      }
    }

    const walletId = typeof params.walletId === "string" ? params.walletId : session.walletId;
    if (!walletId) {
      throw new Error("walletId is required (missing from session and not provided)");
    }

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");

    logger.info(`Signing EIP-712 typed data for wallet ${walletId} on ${networkId}`);

    try {
      const signature = await client.ethereumSignTypedData({
        walletId,
        typedData,
        networkId,
        derivationIndex,
      });

      logger.info(`EIP-712 typed data signed successfully`);

      return { signature };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to sign EIP-712 typed data: ${errorMessage}`);
      throw new Error(`Failed to sign EIP-712 typed data: ${errorMessage}`);
    }
  },
};
