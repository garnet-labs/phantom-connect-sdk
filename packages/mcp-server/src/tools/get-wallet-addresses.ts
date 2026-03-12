/**
 * get_wallet_addresses tool - Gets addresses for the authenticated embedded wallet
 */

import type { ToolHandler, ToolContext } from "./types.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";

export const getWalletAddressesTool: ToolHandler = {
  name: "get_wallet_addresses",
  description:
    "Returns all blockchain addresses (Solana, Ethereum, Bitcoin, Sui) for the authenticated Phantom embedded wallet. " +
    "Call this first to confirm the user is connected and to get their wallet addresses before any transfer or swap. " +
    "Response format: {walletId: string, organizationId: string, addresses: [{addressType: string, address: string}]} " +
    "where addressType is one of 'solana', 'ethereum', 'bitcoin', 'sui'. " +
    "Use the Solana address with send_solana_transaction, sign_solana_message, and transfer_tokens; " +
    "use the Ethereum address with send_evm_transaction, sign_evm_personal_message, and sign_evm_typed_data. " +
    "If this returns an auth error (session expired or revoked), call phantom_login to re-authenticate.",
  inputSchema: {
    type: "object",
    properties: {
      derivationIndex: {
        type: "number",
        description: "Optional derivation index for the addresses",
        minimum: 0,
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (params: Record<string, unknown>, context: ToolContext) => {
    const { client, session, logger } = context;

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");

    logger.info("Getting addresses for wallet");

    try {
      // Call PhantomClient to get wallet addresses
      const addresses = await client.getWalletAddresses(
        session.walletId,
        undefined, // Use default derivation paths (Solana, Ethereum, Bitcoin, Sui)
        derivationIndex,
      );

      logger.info(`Successfully retrieved ${addresses.length} addresses`);

      return {
        walletId: session.walletId,
        organizationId: session.organizationId,
        addresses: addresses.map(addr => ({
          addressType: addr.addressType,
          address: addr.address,
        })),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get wallet addresses: ${errorMessage}`);
      throw new Error(`Failed to get wallet addresses: ${errorMessage}`);
    }
  },
};
