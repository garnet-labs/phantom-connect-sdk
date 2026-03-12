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
import type { ToolHandler, ToolContext } from "./types.js";
import { normalizeNetworkId } from "../utils/network.js";
import { getSolanaAddress } from "../utils/solana.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";

export const sendSolanaTransactionTool: ToolHandler = {
  name: "send_solana_transaction",
  description:
    "Signs and broadcasts a Solana transaction using the authenticated embedded wallet. Accepts a standard base64-encoded serialized transaction (the format returned by Solana DeFi APIs such as Jupiter, Phantom swap, and others). Returns the transaction signature on success.",
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
      walletId: {
        type: "string",
        description: "Optional wallet ID to use for signing (defaults to authenticated wallet)",
      },
      derivationIndex: {
        type: "number",
        description: "Optional derivation index for the account (default: 0)",
        minimum: 0,
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
