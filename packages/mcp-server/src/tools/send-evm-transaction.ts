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
import type { ToolContext } from "./types.js";
import { createTool } from "./types.js";
import { getEthereumAddress, estimateGas, fetchGasPrice, fetchNonce } from "../utils/evm.js";
import { resolveEvmRpcUrl } from "../utils/rpc.js";
import { parseChainId, parseOptionalNonNegativeInteger } from "../utils/params.js";
import { runSimulation } from "../utils/simulation.js";

interface Params {
  chainId: number | string;
  to?: string;
  value?: string;
  data?: string;
  gas?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string;
  type?: string;
  walletId?: string;
  derivationIndex?: number;
  rpcUrl?: string;
  confirmed?: boolean;
}

export const sendEvmTransactionTool = createTool<Params>({
  name: "send_evm_transaction",
  description:
    "Signs and broadcasts an EVM transaction using the authenticated embedded wallet. Accepts the standard EVM transaction object format (the same fields used by eth_sendTransaction and returned by DeFi aggregators). Use the chainId field directly from the aggregator response (e.g. 1 for Ethereum mainnet, 8453 for Base, 137 for Polygon). Missing fields such as nonce and gas are automatically fetched from the network. " +
    "SAFETY: By default (no confirmed flag), this tool runs a simulation and returns expected asset changes and warnings WITHOUT sending anything — use this to show the user what will happen and ask for approval. " +
    "Pass confirmed: true only after the user explicitly approves the preview to actually sign and send. " +
    "If the user wants to skip simulation and execute immediately, pass confirmed: true directly — but the two-step flow is recommended for safety. " +
    "Response WITHOUT confirmed: {status: 'pending_confirmation', simulation: {expectedChanges, warnings, block?, advancedDetails?} | null}. " +
    "Response WITH confirmed: true: {hash, networkId, from, to}.",
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
        description:
          "Transaction nonce as a hex string. If omitted, fetched automatically via eth_getTransactionCount.",
      },
      type: {
        type: "string",
        description:
          'Hex-encoded transaction type (e.g. "0x0" for legacy, "0x2" for EIP-1559, "0x3" for blob). Inferred automatically if omitted.',
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
      confirmed: {
        type: "boolean",
        description:
          "Set to true only after the user has reviewed and approved the simulation results. Omit (or false) on the first call to get a simulation preview without submitting.",
      },
    },
    required: ["chainId"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params, context: ToolContext) => {
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

    const gasParam = typeof (params.gas ?? params.gasLimit) === "string" ? (params.gas ?? params.gasLimit) : undefined;
    const txType = typeof params.type === "string" ? params.type : undefined;
    const gasPrice = typeof params.gasPrice === "string" ? params.gasPrice : undefined;
    const maxFeePerGas = typeof params.maxFeePerGas === "string" ? params.maxFeePerGas : undefined;
    const maxPriorityFeePerGas =
      typeof params.maxPriorityFeePerGas === "string" ? params.maxPriorityFeePerGas : undefined;
    const nonce = typeof params.nonce === "string" ? params.nonce : undefined;

    // Enforce fee model exclusivity consistently for preview and send flows.
    const hasEip1559 = maxFeePerGas !== undefined || maxPriorityFeePerGas !== undefined;
    const hasLegacyGasPrice = gasPrice !== undefined;

    if (hasEip1559 && hasLegacyGasPrice) {
      throw new Error("Cannot mix EIP-1559 fee fields (maxFeePerGas/maxPriorityFeePerGas) with legacy gasPrice");
    }

    const confirmed = params.confirmed === true;

    if (!confirmed) {
      logger.info("Running simulation before sending EVM transaction (confirmed not set)");
      try {
        const simulation = await runSimulation(
          {
            type: "transaction",
            chainId: networkId,
            userAccount: from,
            params: {
              transactions: [
                {
                  from,
                  ...(to !== undefined ? { to } : {}),
                  ...(value !== undefined ? { value } : {}),
                  ...(data !== undefined ? { data } : {}),
                  ...(gasParam !== undefined ? { gas: gasParam } : {}),
                  ...(gasPrice !== undefined ? { gasPrice } : {}),
                  ...(maxFeePerGas !== undefined ? { maxFeePerGas } : {}),
                  ...(maxPriorityFeePerGas !== undefined ? { maxPriorityFeePerGas } : {}),
                  ...(nonce !== undefined ? { nonce } : {}),
                  chainId: `0x${chainId.toString(16)}`,
                  ...(txType !== undefined ? { type: txType } : {}),
                },
              ],
            },
          },
          context,
        );
        logger.info("Simulation complete — awaiting user confirmation");
        return { status: "pending_confirmation", simulation };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Unable to simulate transaction at the moment: ${errorMessage}`);
        return { status: "pending_confirmation", simulation: null };
      }
    }

    // Build base tx object for gas estimation and RLP encoding.
    // chainId as a number matches browser SDK behavior for parseToKmsTransaction/ethers.
    const baseTx: Record<string, unknown> = { from, chainId };
    if (to !== undefined) baseTx.to = to;
    if (value !== undefined) baseTx.value = value;
    if (data !== undefined) baseTx.data = data;
    if (txType !== undefined) baseTx.type = txType;
    if (maxFeePerGas !== undefined) baseTx.maxFeePerGas = maxFeePerGas;
    if (maxPriorityFeePerGas !== undefined) baseTx.maxPriorityFeePerGas = maxPriorityFeePerGas;

    // Fetch nonce from chain if not explicitly provided — the KMS does not reliably auto-assign it.
    baseTx.nonce = typeof params.nonce === "string" ? params.nonce : await fetchNonce(rpcUrl, from);

    // Auto-fill gas (limit) if not provided — accept both "gas" and "gasLimit" (aggregators often use gasLimit)
    const gas = gasParam ?? (await estimateGas(rpcUrl, { from, to, value, data })); // chainId omitted — implied by rpcUrl
    baseTx.gas = gas;

    if (!hasEip1559) {
      baseTx.gasPrice = gasPrice ?? (await fetchGasPrice(rpcUrl));
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
});
