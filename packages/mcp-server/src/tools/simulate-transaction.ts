/**
 * simulate_transaction tool - Preview transaction effects using Phantom's simulation API.
 * Calls POST /simulation/v1 and returns expected
 * asset changes, security warnings, and blocking conditions without submitting on-chain.
 */

import type { ToolContext } from "./types.js";
import { createTool } from "./types.js";
import { getSolanaAddress } from "../utils/solana.js";
import { getEthereumAddress } from "../utils/evm.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";
import { runSimulation } from "../utils/simulation.js";

interface Params {
  chainId: string;
  type: "transaction" | "message";
  params: Record<string, unknown>;
  url?: string;
  context?: "swap" | "bridge" | "send" | "gaslessSwap";
  userAccount?: string;
  language?: string;
  derivationIndex?: number;
  walletId?: string;
}

export const simulateTransactionTool = createTool<Params>({
  name: "simulate_transaction",
  description:
    "Phantom Wallet — Simulates a transaction and returns expected asset changes, security warnings, and blocking " +
    "conditions — without submitting it on-chain. Use this to preview what a transaction will do before signing " +
    "or sending. Supports Solana, EVM (Ethereum, Base, Polygon, Arbitrum, Monad), Sui, and Bitcoin. " +
    "Built on top of Phantom's transaction simulation service. " +
    "The `userAccount` wallet address is auto-derived from the authenticated session for Solana and EVM chains; " +
    "supply it explicitly for Sui and Bitcoin. " +
    "Chain-specific `params` shapes: " +
    "Solana transaction — { transactions: ['<base58>'], method?, simulatorConfig?: { decodeAccounts?, decodeInstructions? } }; " +
    "EVM transaction — { transactions: [{ from, to, value, data, chainId, type }] }; " +
    "Sui transaction — { rawTransaction: '<bytes>' }; " +
    "Bitcoin transaction — { transaction: '<raw>', userAddresses?: ['bc1q...'] }; " +
    "EVM message signing — { message: '0x...' }. " +
    "Response: { type, expectedChanges: [{ type, changeSign: PLUS|MINUS|EQUAL, changeText, asset: { type, amount, decimals, symbol, usdValue } }], " +
    "warnings: [{ message, severity: 1-5 }], block?: { message, severity }, advancedDetails?: { chainId, totalFee, feePayers, gas, contractAddresses } }.",
  inputSchema: {
    type: "object",
    properties: {
      chainId: {
        type: "string",
        description:
          "CAIP-2 chain ID for the transaction. " +
          "Solana: 'solana:mainnet' | 'solana:devnet'. " +
          "EVM: 'eip155:1' (Ethereum), 'eip155:8453' (Base), 'eip155:137' (Polygon), 'eip155:42161' (Arbitrum), 'eip155:143' (Monad). " +
          "Sui: 'sui:mainnet'. Bitcoin: 'bip122:000000000019d6689c085ae165831e93'.",
      },
      type: {
        type: "string",
        enum: ["transaction", "message"],
        description: "Whether this is a transaction or a message signing request.",
      },
      params: {
        type: "object",
        description: "Chain-specific transaction parameters. Shape varies by chain — see tool description for details.",
      },
      url: {
        type: "string",
        description: "dApp origin URL where the transaction originates (e.g. 'https://jup.ag'). Optional.",
      },
      context: {
        type: "string",
        enum: ["swap", "bridge", "send", "gaslessSwap"],
        description: "Optional transaction context hint for more accurate simulation.",
      },
      userAccount: {
        type: "string",
        description:
          "Wallet address to simulate for. Auto-derived from the authenticated session for Solana and EVM chains. " +
          "Required for Sui and Bitcoin if not determinable from session.",
      },
      language: {
        type: "string",
        description: "Response language code (e.g. 'en', 'es', 'ja'). Defaults to 'en'.",
      },
      derivationIndex: {
        type: "number",
        description: "HD wallet derivation index for address lookup. Defaults to 0.",
        minimum: 0,
      },
    },
    required: ["chainId", "type", "params"],
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true,
  },
  handler: async (params, context: ToolContext) => {
    const { session, logger } = context;

    // Validate required fields
    if (!params.chainId) {
      throw new Error("chainId must be a non-empty string (e.g. 'solana:mainnet', 'eip155:1')");
    }
    if (params.type !== "transaction" && params.type !== "message") {
      throw new Error("type must be 'transaction' or 'message'");
    }
    if (typeof params.params !== "object" || params.params === null) {
      throw new Error("params must be an object containing chain-specific transaction parameters");
    }

    const chainId = params.chainId;
    const txType = params.type;
    const txParams = params.params;
    const language = typeof params.language === "string" && params.language ? params.language : "en";
    const walletId = typeof params.walletId === "string" && params.walletId ? params.walletId : session.walletId;
    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");

    // Auto-derive userAccount if not provided
    let userAccount = typeof params.userAccount === "string" ? params.userAccount : undefined;

    if (!userAccount) {
      const normalizedChain = chainId.toLowerCase();
      if (normalizedChain.startsWith("solana:")) {
        userAccount = await getSolanaAddress(context, walletId, derivationIndex);
        logger.debug(`Auto-derived Solana userAccount: ${userAccount}`);
      } else if (normalizedChain.startsWith("eip155:")) {
        userAccount = await getEthereumAddress(context, walletId, derivationIndex);
        logger.debug(`Auto-derived EVM userAccount: ${userAccount}`);
      } else {
        // Sui and Bitcoin: attempt to look up by addressType; proceed without if not found
        const allAddresses = await context.client.getWalletAddresses(walletId, undefined, derivationIndex);
        const addressTypePrefix = normalizedChain.startsWith("sui:") ? "sui" : "bitcoin";
        const match = allAddresses.find(a => a.addressType.toLowerCase() === addressTypePrefix);
        if (match) {
          userAccount = match.address;
          logger.debug(`Auto-derived ${addressTypePrefix} userAccount: ${userAccount}`);
        } else {
          logger.debug(`No ${addressTypePrefix} address found in wallet; proceeding without userAccount`);
        }
      }
    }

    // Build request body — omit undefined optional fields
    const body = {
      type: txType,
      chainId,
      params: txParams,
      ...(userAccount ? { userAccount } : {}),
      ...(typeof params.url === "string" && params.url ? { url: params.url } : {}),
      ...(params.context ? { context: params.context } : {}),
    };

    logger.info(`Simulating ${txType} on ${chainId} (userAccount: ${userAccount ?? "not set"})`);

    const result = await runSimulation(body, context, language);

    logger.info("Simulation completed successfully");
    return result;
  },
});
