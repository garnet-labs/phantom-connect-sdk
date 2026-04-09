/**
 * send_solana_transaction tool
 *
 * Accepts a standard base64-encoded serialized Solana transaction (the format
 * used by Solana JSON-RPC and returned by DeFi APIs), signs it using the
 * authenticated embedded wallet, and broadcasts it to the network.
 *
 * Mirrors sdk.solana.signAndSendTransaction(tx) from the browser-sdk.
 */

import type { NetworkId } from "@phantom/client";
import { WalletServiceError } from "@phantom/client";
import { isSolanaChain } from "@phantom/utils";
import { base64urlEncode } from "@phantom/base64url";
import bs58 from "bs58";
import type { ToolHandler, ToolContext } from "./types.js";
import { normalizeNetworkId, normalizeSwapperChainId } from "../utils/network.js";
import { getSolanaAddress } from "../utils/solana.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";
import { runSimulation } from "../utils/simulation.js";

export const sendSolanaTransactionTool: ToolHandler = {
  name: "send_solana_transaction",
  description:
    "Signs and broadcasts a Solana transaction using the authenticated embedded wallet. Accepts a standard base64-encoded serialized transaction (the format returned by Solana DeFi APIs such as Jupiter, Phantom swap, and others). " +
    "SAFETY: By default (no confirmed flag), this tool runs a simulation and returns expected asset changes and warnings WITHOUT sending anything — use this to show the user what will happen and ask for approval. " +
    "Pass confirmed: true only after the user explicitly approves the preview to actually sign and send. " +
    "If the user wants to skip simulation and execute immediately, pass confirmed: true directly — but the two-step flow is recommended for safety. " +
    "Response WITHOUT confirmed: {status: 'pending_confirmation', simulation: {expectedChanges, warnings, block?, advancedDetails?} | null}. " +
    "Response WITH confirmed: true: {signature, networkId, account}.",
  inputSchema: {
    type: "object",
    properties: {
      transaction: {
        type: "string",
        description:
          "The serialized Solana transaction encoded as standard base64 (the format used by Solana JSON-RPC and DeFi APIs). Do not base58-encode — use base64.",
      },
      networkId: {
        type: "string",
        description:
          'Solana network identifier (e.g., "solana:mainnet", "solana:devnet"). Defaults to "solana:mainnet" if not provided.',
      },
      derivationIndex: {
        type: "number",
        description: "Optional derivation index for the account (default: 0)",
        minimum: 0,
      },
      confirmed: {
        type: "boolean",
        description:
          "Set to true only after the user has reviewed and approved the simulation results. Omit (or false) on the first call to get a simulation preview without submitting.",
      },
    },
    required: ["transaction"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params: Record<string, unknown>, context: ToolContext) => {
    const { client, session, logger } = context;

    if (typeof params.transaction !== "string") {
      throw new Error("transaction must be a string");
    }

    const rawNetworkId = typeof params.networkId === "string" ? params.networkId : "solana:mainnet";
    const networkId = normalizeNetworkId(rawNetworkId) as NetworkId;
    if (!isSolanaChain(networkId)) {
      throw new Error("send_solana_transaction supports Solana networks only");
    }

    const walletId = typeof params.walletId === "string" ? params.walletId : session.walletId;
    if (!walletId) {
      throw new Error("walletId is required (missing from session and not provided)");
    }

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");

    // Validate strict standard base64 (no URL-safe chars, correct padding)
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(params.transaction) || params.transaction.length % 4 === 1) {
      throw new Error(
        "transaction is not valid base64 — use standard base64 encoding (A-Za-z0-9+/=) with correct padding",
      );
    }

    // Decode standard base64 → bytes → re-encode as base64url (what PhantomClient KMS expects)
    const txBytes = new Uint8Array(Buffer.from(params.transaction, "base64"));
    if (txBytes.length === 0) {
      throw new Error("transaction decoded to empty bytes — ensure it is valid base64");
    }

    const encoded = base64urlEncode(txBytes);
    const account = await getSolanaAddress(context, walletId, derivationIndex);
    const confirmed = params.confirmed === true;

    if (!confirmed) {
      logger.info("Running simulation before sending Solana transaction (confirmed not set)");
      const base58Tx = bs58.encode(txBytes);
      try {
        const simulation = await runSimulation(
          {
            type: "transaction",
            chainId: normalizeSwapperChainId(networkId),
            userAccount: account,
            params: { transactions: [base58Tx], method: "signAndSendTransaction" },
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

    logger.info(`Sending Solana transaction for wallet ${walletId} on ${networkId}`);

    try {
      const result = await client.signAndSendTransaction({
        walletId,
        transaction: encoded,
        networkId,
        derivationIndex,
        account,
      });

      logger.info(`Solana transaction sent: ${result.hash ?? "no hash"}`);

      return {
        signature: result.hash ?? null,
        networkId,
        account,
      };
    } catch (error) {
      if (error instanceof WalletServiceError) {
        logger.error(
          `Solana transaction rejected by wallet service: type=${error.type} title="${error.title}" detail="${error.detail}" requestId=${error.requestId}`,
        );
        throw new Error(`Failed to send Solana transaction: ${error.detail || error.title || error.message}`);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send Solana transaction: ${errorMessage}`);
      logger.error(`Full error detail: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
      throw new Error(`Failed to send Solana transaction: ${errorMessage}`);
    }
  },
};
