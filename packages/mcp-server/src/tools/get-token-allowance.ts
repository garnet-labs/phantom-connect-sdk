/**
 * get_token_allowance tool
 *
 * Returns the ERC-20 allowance granted by an owner to a spender on any supported EVM chain.
 * Useful before a swap to check whether an approval transaction is needed.
 */

import type { NetworkId } from "@phantom/client";
import { isEthereumChain } from "@phantom/utils";
import { chainIdToNetworkId } from "@phantom/constants";
import type { ToolHandler, ToolContext } from "./types.js";
import { getEthereumAddress } from "../utils/evm.js";
import { fetchERC20Allowance } from "../utils/allowance.js";
import { resolveEvmRpcUrl } from "../utils/rpc.js";
import { parseChainId, parseOptionalNonNegativeInteger } from "../utils/params.js";

export const getTokenAllowanceTool: ToolHandler = {
  name: "get_token_allowance",
  description:
    "Returns the ERC-20 token allowance granted by an owner address to a spender address on a supported EVM chain. " +
    "Use this before a swap to check whether an approval transaction is needed. " +
    "If ownerAddress is omitted, the authenticated wallet address for the chain is used.",
  inputSchema: {
    type: "object",
    properties: {
      chainId: {
        type: ["number", "string"],
        description:
          'EVM chain ID (e.g. 8453 for Base, 1 for Ethereum, 137 for Polygon). Accepts a number, decimal string, or hex string (e.g. "0x2105").',
      },
      tokenAddress: {
        type: "string",
        description: "ERC-20 token contract address (0x-prefixed).",
      },
      spenderAddress: {
        type: "string",
        description: "Address of the spender to check allowance for (e.g. a swap router).",
      },
      ownerAddress: {
        type: "string",
        description: "Address of the token owner. If omitted, the authenticated wallet address for the chain is used.",
      },
      walletId: {
        type: "string",
        description: "Optional wallet ID (defaults to authenticated wallet). Only used when ownerAddress is omitted.",
      },
      derivationIndex: {
        type: "number",
        description:
          "Optional derivation index for the wallet address (default: 0). Only used when ownerAddress is omitted.",
        minimum: 0,
      },
      rpcUrl: {
        type: "string",
        description: "Optional EVM RPC URL override.",
      },
    },
    required: ["chainId", "tokenAddress", "spenderAddress"],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (params: Record<string, unknown>, context: ToolContext) => {
    const { session, logger } = context;

    const chainId = parseChainId(params.chainId);
    const networkId = chainIdToNetworkId(chainId) as NetworkId | undefined;
    if (!networkId || !isEthereumChain(networkId)) {
      throw new Error(
        `Unsupported chainId: ${chainId}. Use a supported EVM chain ID (e.g. 1 for Ethereum, 8453 for Base, 137 for Polygon).`,
      );
    }

    const tokenAddress = typeof params.tokenAddress === "string" ? params.tokenAddress : undefined;
    if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
      throw new Error("tokenAddress must be a valid EVM address (0x-prefixed, 40 hex chars)");
    }

    const spenderAddress = typeof params.spenderAddress === "string" ? params.spenderAddress : undefined;
    if (!spenderAddress || !/^0x[0-9a-fA-F]{40}$/.test(spenderAddress)) {
      throw new Error("spenderAddress must be a valid EVM address (0x-prefixed, 40 hex chars)");
    }

    const rpcUrl = resolveEvmRpcUrl(networkId, typeof params.rpcUrl === "string" ? params.rpcUrl : undefined);

    // Resolve owner: explicit address or derive from wallet
    let ownerAddress: string;
    if (typeof params.ownerAddress === "string") {
      if (!/^0x[0-9a-fA-F]{40}$/.test(params.ownerAddress)) {
        throw new Error("ownerAddress must be a valid EVM address (0x-prefixed, 40 hex chars)");
      }
      ownerAddress = params.ownerAddress;
    } else {
      const walletId = typeof params.walletId === "string" ? params.walletId : session.walletId;
      if (!walletId) throw new Error("walletId is required when ownerAddress is not provided");
      const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");
      ownerAddress = await getEthereumAddress(context, walletId, derivationIndex);
    }

    logger.info(`Checking ERC-20 allowance: token=${tokenAddress} owner=${ownerAddress} spender=${spenderAddress}`);

    const allowance = await fetchERC20Allowance(rpcUrl, tokenAddress, ownerAddress, spenderAddress);
    const allowanceDecimal = allowance.toString();
    const allowanceHex = "0x" + allowance.toString(16);

    return {
      chainId,
      tokenAddress,
      ownerAddress,
      spenderAddress,
      allowance: allowanceDecimal,
      allowanceHex,
    };
  },
};
