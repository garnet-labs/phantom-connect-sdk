/**
 * pay_api_access tool — signs and broadcasts the unsigned CASH token transfer tx
 * returned in an API_PAYMENT_REQUIRED error, then stores the signature so all
 * subsequent requests are automatically unlocked for the rest of the day.
 */

import { AddressType, type NetworkId } from "@phantom/client";
import { base64urlEncode } from "@phantom/base64url";
import { normalizeNetworkId } from "../utils/network.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";
import type { ToolHandler, ToolContext } from "./types.js";

export const payApiAccessTool: ToolHandler = {
  name: "pay_api_access",
  description:
    "Phantom Wallet — Pays for daily API access by signing and broadcasting the CASH token transfer " +
    "transaction included in an API_PAYMENT_REQUIRED error response. " +
    "Call this when any tool returns error code API_PAYMENT_REQUIRED, passing the preparedTx from that response. " +
    "On success, the payment signature is stored and API calls are unlocked until the purchased quota is consumed. " +
    "After calling this, retry the original tool that triggered the payment requirement.",
  inputSchema: {
    type: "object",
    properties: {
      preparedTx: {
        type: "string",
        description: "Base64-encoded unsigned Solana transaction from the API_PAYMENT_REQUIRED error response",
      },
      walletId: {
        type: "string",
        description: "Optional wallet ID (defaults to authenticated wallet)",
      },
      derivationIndex: {
        type: "number",
        description: "Optional derivation index (default: 0)",
        minimum: 0,
      },
    },
    required: ["preparedTx"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  handler: async (params: Record<string, unknown>, context: ToolContext) => {
    const { client, session, apiClient } = context;

    if (typeof params.preparedTx !== "string" || !params.preparedTx) {
      throw new Error("preparedTx is required");
    }

    const walletId = typeof params.walletId === "string" ? params.walletId : session.walletId;
    if (!walletId) throw new Error("walletId is required");

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");

    const txBytes = Buffer.from(params.preparedTx, "base64");
    if (!txBytes.length) throw new Error("preparedTx decoded to empty — invalid base64");

    const addresses = await client.getWalletAddresses(walletId, undefined, derivationIndex);
    const solanaAddress = addresses.find(a => a.addressType === AddressType.solana)?.address;
    if (!solanaAddress) throw new Error("No Solana address found for this wallet");

    const result = await client.signAndSendTransaction({
      walletId,
      transaction: base64urlEncode(txBytes),
      networkId: normalizeNetworkId("solana:mainnet") as NetworkId,
      account: solanaAddress,
      derivationIndex,
    });

    if (!result.hash) throw new Error("Transaction submitted but no signature returned");

    // Store the signature — included as X-Payment on all subsequent requests
    apiClient.setPaymentSignature(result.hash);

    return {
      success: true,
      signature: result.hash,
      message:
        "API quota refreshed. Retry the original action now. You may need to pay again if you hit the quota limit.",
    };
  },
};
