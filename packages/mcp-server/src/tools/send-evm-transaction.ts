/**
 * send_evm_transaction tool
 *
 * Accepts a standard EVM transaction object (the format used by eth_sendTransaction,
 * returned by DeFi aggregators), fills in any missing
 * fields (nonce, gas, gasPrice) via RPC, signs it, and broadcasts it to the network.
 *
 * Mirrors sdk.ethereum.sendTransaction(tx) from the browser-sdk.
 */

import type { NetworkId } from "@phantom/client";
import { isEthereumChain } from "@phantom/utils";
import { parseToKmsTransaction } from "@phantom/parsers";
import { chainIdToNetworkId } from "@phantom/constants";
import type { ToolHandler, ToolContext } from "./types.js";
import { getEthereumAddress, resolveEvmRpcUrl, estimateGas, fetchGasPrice } from "../utils/evm.js";
import { parseChainId, parseOptionalNonNegativeInteger } from "../utils/params.js";

export const sendEvmTransactionTool: ToolHandler = {
  name: "send_evm_transaction",
  description:
    "Signs and broadcasts an EVM transaction using the authenticated embedded wallet. Accepts the standard EVM transaction object format (the same fields used by eth_sendTransaction and returned by DeFi aggregators). Use the chainId field directly from the aggregator response (e.g. 1 for Ethereum mainnet, 8453 for Base, 137 for Polygon). Missing fields such as nonce and gas are automatically fetched from the network.",
  inputSchema: {
    type: "object",
    properties: {
      chainId: {
        type: ["number", "string"],
        description:
          'EVM chain ID as a number or string (e.g. 8453, "8453", or "0x2105" for Base). This is the chainId field returned directly by DeFi aggregators.',
      },
      to: {
        type: "string",
        description: "Recipient address (0x-prefixed hex)",
      },
      value: {
        type: "string",
        description:
          'Amount to send in wei, as a hex string or decimal string (e.g., "0x38D7EA4C68000" or "1000000000000000")',
      },
      data: {
        type: "string",
        description: "Encoded contract call data (0x-prefixed hex). Omit for plain ETH transfers.",
      },
      gas: {
        type: "string",
        description:
          'Gas limit as a hex string (e.g., "0x5208" for 21000). If omitted, estimated automatically from the network with a 20% buffer.',
      },
      gasLimit: {
        type: "string",
        description:
          "Gas limit as a hex string — alias for gas, accepted directly from DeFi aggregator responses. If both gas and gasLimit are provided, gas takes precedence.",
      },
      gasPrice: {
        type: "string",
        description:
          "Gas price in wei as a hex string (legacy transactions). Use maxFeePerGas + maxPriorityFeePerGas for EIP-1559 transactions. If neither gasPrice nor maxFeePerGas is provided, gasPrice is fetched automatically.",
      },
      maxFeePerGas: {
        type: "string",
        description: "Maximum total fee per gas in wei (EIP-1559, hex string)",
      },
      maxPriorityFeePerGas: {
        type: "string",
        description: "Maximum priority fee (tip) per gas in wei (EIP-1559, hex string)",
      },
      nonce: {
        type: "string",
        description: "Transaction nonce as a hex string. If omitted, the KMS assigns the correct nonce automatically.",
      },
      type: {
        type: "string",
        description: 'Transaction type: "0x0" for legacy, "0x2" for EIP-1559. Inferred automatically if omitted.',
      },
      walletId: {
        type: "string",
        description: "Optional wallet ID to use for signing (defaults to authenticated wallet)",
      },
      derivationIndex: {
        type: "number",
        description: "Optional derivation index for the account (default: 0)",
        minimum: 0,
      },
      rpcUrl: {
        type: "string",
        description: "Optional EVM RPC URL override. Defaults are provided for common networks.",
      },
    },
    required: ["chainId"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params: Record<string, unknown>, context: ToolContext) => {
    const { client, session, logger } = context;

    const chainId = parseChainId(params.chainId);

    const networkId = chainIdToNetworkId(chainId) as NetworkId | undefined;
    if (!networkId || !isEthereumChain(networkId)) {
      throw new Error(
        `Unsupported chainId: ${chainId}. Use a supported EVM chain ID (e.g. 1 for Ethereum, 8453 for Base, 137 for Polygon, 42161 for Arbitrum).`,
      );
    }

    const walletId = typeof params.walletId === "string" ? params.walletId : session.walletId;
    if (!walletId) {
      throw new Error("walletId is required (missing from session and not provided)");
    }

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");
    const rpcUrl = resolveEvmRpcUrl(networkId, typeof params.rpcUrl === "string" ? params.rpcUrl : undefined);

    // Resolve the sender address from the wallet
    const from = await getEthereumAddress(context, walletId, derivationIndex);

    const to = typeof params.to === "string" ? params.to : undefined;
    const value = typeof params.value === "string" ? params.value : undefined;
    const data = typeof params.data === "string" ? params.data : undefined;

    // Build base tx object for gas estimation and RLP encoding.
    // chainId as a number matches browser SDK behavior for parseToKmsTransaction/ethers.
    const baseTx: Record<string, unknown> = { from, chainId };
    if (to !== undefined) baseTx.to = to;
    if (value !== undefined) baseTx.value = value;
    if (data !== undefined) baseTx.data = data;
    if (typeof params.type === "string") baseTx.type = params.type;
    if (typeof params.maxFeePerGas === "string") baseTx.maxFeePerGas = params.maxFeePerGas;
    if (typeof params.maxPriorityFeePerGas === "string") baseTx.maxPriorityFeePerGas = params.maxPriorityFeePerGas;

    // Only include nonce when explicitly provided — the KMS assigns the correct nonce otherwise,
    // matching the embedded provider's behavior which never pre-fetches it.
    if (typeof params.nonce === "string") baseTx.nonce = params.nonce;

    // Auto-fill gas (limit) if not provided — accept both "gas" and "gasLimit" (aggregators often use gasLimit)
    const gasParam = params.gas ?? params.gasLimit;
    const gas = typeof gasParam === "string" ? gasParam : await estimateGas(rpcUrl, { from, to, value, data }); // chainId omitted — implied by rpcUrl
    baseTx.gas = gas;

    // Enforce fee model exclusivity and auto-fill gasPrice for legacy transactions
    const hasEip1559 = typeof params.maxFeePerGas === "string" || typeof params.maxPriorityFeePerGas === "string";
    const hasLegacyGasPrice = typeof params.gasPrice === "string";

    if (hasEip1559 && hasLegacyGasPrice) {
      throw new Error("Cannot mix EIP-1559 fee fields (maxFeePerGas/maxPriorityFeePerGas) with legacy gasPrice");
    }

    if (!hasEip1559) {
      baseTx.gasPrice = hasLegacyGasPrice ? params.gasPrice : await fetchGasPrice(rpcUrl);
    }

    logger.info(`Sending EVM transaction from ${from} on ${networkId}`);

    // RLP-encode via @phantom/parsers (handles JSON → RLP hex via ethers)
    const { parsed: rlpHex } = await parseToKmsTransaction(baseTx, networkId);
    if (!rlpHex) {
      throw new Error("Failed to RLP-encode EVM transaction");
    }

    try {
      const result = await client.signAndSendTransaction({
        walletId,
        transaction: rlpHex,
        networkId,
        derivationIndex,
        account: from,
      });

      const { hash } = result;
      logger.info(`EVM transaction sent: ${hash ?? "no hash"}`);

      return {
        hash: hash ?? null,
        networkId,
        from,
        to: to ?? null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send EVM transaction: ${errorMessage}`);
      throw new Error(`Failed to send EVM transaction: ${errorMessage}`);
    }
  },
};
