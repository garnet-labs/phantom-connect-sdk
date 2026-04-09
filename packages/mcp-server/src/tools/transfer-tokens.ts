/**
 * transfer_tokens tool - Transfers native tokens or fungible tokens on Solana and EVM chains.
 */

import bs58 from "bs58";
import { base64urlEncode } from "@phantom/base64url";
import type { NetworkId } from "@phantom/client";
import { isSolanaChain } from "@phantom/utils";
import { parseToKmsTransaction } from "@phantom/parsers";
import { Connection, PublicKey, SystemProgram, Transaction, type Commitment } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";
import type { ToolHandler, ToolContext } from "./types.js";
import { normalizeNetworkId, normalizeSwapperChainId } from "../utils/network.js";
import { getSolanaAddress } from "../utils/solana.js";
import { getEthereumAddress, estimateGas, fetchGasPrice, fetchNonce, assertEvmAddress } from "../utils/evm.js";
import { resolveSolanaRpcUrl, resolveEvmRpcUrl } from "../utils/rpc.js";
import { parseBaseUnitAmount, parseUiAmount, requirePositiveAmount } from "../utils/amount.js";
import { parseOptionalNonNegativeInteger } from "../utils/params.js";
import { runSimulation } from "../utils/simulation.js";

const DEFAULT_COMMITMENT: Commitment = "confirmed";

/**
 * Encodes an ERC-20 transfer(address,uint256) calldata.
 * Selector: 0xa9059cbb
 */
function encodeErc20Transfer(recipient: string, amount: bigint): string {
  const recipientHex = recipient.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
  const amountHex = amount.toString(16).padStart(64, "0");
  return `0xa9059cbb${recipientHex}${amountHex}`;
}

export const transferTokensTool: ToolHandler = {
  name: "transfer_tokens",
  description:
    "Transfers native tokens or fungible tokens on Solana and EVM chains. " +
    "Use this for direct token sends (e.g. 'send 1 SOL to X', 'send 0.01 ETH to Y', 'transfer 100 USDC on Base'). " +
    "For swaps/exchanges (e.g. 'swap USDC for SOL'), use buy_token instead. " +
    "Solana: supports SOL and SPL tokens. EVM: supports native tokens (ETH, MATIC, etc.) and ERC-20 tokens. " +
    "IMPORTANT: The sending wallet must hold enough native token for fees (SOL on Solana, ETH/native on EVM). " +
    "For ERC-20 transfers, provide decimals when using amountUnit: 'ui'. " +
    "TWO-STEP FLOW — always call this tool twice: " +
    "(1) First call WITHOUT confirmed (or confirmed: false): builds the transaction, runs a simulation, and returns the preview " +
    "showing expected asset changes, warnings, and any blocking conditions. " +
    "Present these results to the user and ask 'Does this look correct? Shall I proceed with the transfer?' " +
    "If the simulation is blocked (block field is set), inform the user and do NOT proceed. " +
    "(2) Second call WITH confirmed: true (only after explicit user approval): builds and submits the transaction. " +
    "Response WITHOUT confirmed: {simulation: {expectedChanges, warnings, block?, advancedDetails?}, status: 'pending_confirmation'}. " +
    "Response WITH confirmed: true: {walletId, networkId, from, to, tokenMint: string|null, signature: string|null, rawTransaction: string}.",
  inputSchema: {
    type: "object",
    properties: {
      networkId: {
        type: "string",
        description:
          'Network identifier. Solana: "solana:mainnet", "solana:devnet". EVM: "eip155:1" (Ethereum), "eip155:8453" (Base), "eip155:137" (Polygon), "eip155:42161" (Arbitrum), "eip155:143" (Monad).',
      },
      to: {
        type: "string",
        description: "Recipient address — Solana base58 address or EVM 0x-prefixed address",
      },
      amount: {
        type: ["string", "number"],
        description: 'Transfer amount (e.g., "0.5", 0.5, "1000000", or 1000000)',
      },
      amountUnit: {
        type: "string",
        description:
          "Amount unit: 'ui' for human-readable units (SOL, ETH, token units), 'base' for atomic units (lamports, wei). Default: 'ui'",
        enum: ["ui", "base"],
      },
      tokenMint: {
        type: "string",
        description:
          "Token contract address — Solana SPL mint address or EVM ERC-20 contract address (0x-prefixed). Omit for native token transfers.",
      },
      decimals: {
        type: "number",
        description:
          "Token decimals — optional for Solana (fetched from chain if omitted); required for ERC-20 tokens when amountUnit is 'ui'",
        minimum: 0,
      },
      derivationIndex: {
        type: "number",
        description: "Optional derivation index for the account (default: 0)",
        minimum: 0,
      },
      rpcUrl: {
        type: "string",
        description: "Optional RPC URL override (Solana or EVM, defaults based on networkId)",
      },
      createAssociatedTokenAccount: {
        type: "boolean",
        description: "Solana only: create destination associated token account if missing (default: true)",
      },
      confirmed: {
        type: "boolean",
        description:
          "Set to true only after the user has reviewed and approved the simulation results. " +
          "Omit (or false) on the first call to get a simulation preview without submitting.",
      },
    },
    required: ["networkId", "to", "amount"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  handler: async (params: Record<string, unknown>, context: ToolContext) => {
    const { client, session, logger } = context;

    if (typeof params.networkId !== "string") throw new Error("networkId must be a string");
    if (typeof params.to !== "string") throw new Error("to must be a string");
    if (typeof params.amount !== "string" && typeof params.amount !== "number") {
      throw new Error(`amount must be a string or number, got type: ${typeof params.amount}`);
    }

    const normalizedNetworkId = normalizeNetworkId(params.networkId);
    const isEvm = normalizedNetworkId.startsWith("eip155:");
    const isSolana = isSolanaChain(normalizedNetworkId);

    if (!isSolana && !isEvm) {
      throw new Error(
        `Unsupported network: ${params.networkId}. Use a Solana network (solana:mainnet, solana:devnet) or EVM chain (eip155:1, eip155:8453, eip155:137, eip155:42161, eip155:143).`,
      );
    }

    const amount = params.amount as string | number;
    const walletId = typeof params.walletId === "string" ? params.walletId : session.walletId;
    if (!walletId) throw new Error("walletId is required (missing from session and not provided)");

    const derivationIndex = parseOptionalNonNegativeInteger(params.derivationIndex, "derivationIndex");
    const amountUnit = typeof params.amountUnit === "string" ? params.amountUnit : "ui";
    if (amountUnit !== "ui" && amountUnit !== "base") throw new Error("amountUnit must be 'ui' or 'base'");

    const tokenMint = typeof params.tokenMint === "string" ? params.tokenMint : undefined;
    const rpcUrlOverride = typeof params.rpcUrl === "string" ? params.rpcUrl : undefined;
    const confirmed = params.confirmed === true;

    // ─── EVM path ────────────────────────────────────────────────────────────
    if (isEvm) {
      const from = await getEthereumAddress(context, walletId, derivationIndex);
      const to = params.to;

      assertEvmAddress(to, "to");

      // Extract numeric chainId from "eip155:N"
      const chainId = parseInt(normalizedNetworkId.split(":")[1], 10);

      const rpcUrl = resolveEvmRpcUrl(normalizedNetworkId, rpcUrlOverride);

      let txTo: string;
      let value: string;
      let data: string | undefined;

      if (!tokenMint) {
        // Native transfer (ETH, MATIC, etc.)
        const amountWei =
          amountUnit === "base" ? parseBaseUnitAmount(amount) : parseUiAmount(amount, 18 /* native EVM decimals */);
        requirePositiveAmount(amountWei);
        value = "0x" + amountWei.toString(16);
        txTo = to;
      } else {
        // ERC-20 transfer
        if (!/^0x[0-9a-fA-F]{40}$/.test(tokenMint)) {
          throw new Error("tokenMint must be a valid EVM contract address (0x-prefixed, 40 hex chars) for EVM chains");
        }

        let tokenDecimals: number;
        if (typeof params.decimals === "number") {
          if (!Number.isInteger(params.decimals) || params.decimals < 0) {
            throw new Error("decimals must be a non-negative integer");
          }
          tokenDecimals = params.decimals;
        } else if (amountUnit === "ui") {
          throw new Error(
            "decimals is required for ERC-20 token transfers when amountUnit is 'ui'. Provide the token's decimal places (e.g. 6 for USDC, 18 for most ERC-20s).",
          );
        } else {
          tokenDecimals = 0; // base units: treat amount as raw integer, decimals irrelevant
        }

        const amountBaseUnits =
          amountUnit === "base" ? parseBaseUnitAmount(amount) : parseUiAmount(amount, tokenDecimals);
        requirePositiveAmount(amountBaseUnits);

        data = encodeErc20Transfer(to, amountBaseUnits);
        value = "0x0";
        txTo = tokenMint;
      }

      logger.info(`Preparing EVM transfer from ${from} to ${to} on ${normalizedNetworkId}`);

      try {
        const baseTx: Record<string, unknown> = { from, to: txTo, value, chainId };
        if (data) baseTx.data = data;

        // ── Simulate before submitting ───────────────────────────────────────
        if (!confirmed) {
          logger.info("Running simulation before transfer (confirmed not set)");
          const simulation = await runSimulation(
            {
              type: "transaction",
              chainId: normalizedNetworkId,
              userAccount: from,
              params: {
                transactions: [
                  {
                    from,
                    to: txTo,
                    value,
                    chainId: `0x${chainId.toString(16)}`,
                    type: "0x2",
                    ...(data ? { data } : {}),
                  },
                ],
              },
            },
            context,
          );
          logger.info("Simulation complete — awaiting user confirmation");
          return { status: "pending_confirmation", simulation };
        }

        const [gas, gasPrice, nonce] = await Promise.all([
          estimateGas(rpcUrl, { from, to: txTo, value, ...(data ? { data } : {}) }),
          fetchGasPrice(rpcUrl),
          fetchNonce(rpcUrl, from),
        ]);
        baseTx.gas = gas;
        baseTx.gasPrice = gasPrice;
        baseTx.nonce = nonce;

        const { parsed: rlpHex } = await parseToKmsTransaction(baseTx, normalizedNetworkId as NetworkId);
        if (!rlpHex) throw new Error("Failed to RLP-encode EVM transaction");

        const result = await client.signAndSendTransaction({
          walletId,
          transaction: rlpHex,
          networkId: normalizedNetworkId as NetworkId,
          derivationIndex,
          account: from,
        });

        logger.info(`EVM transfer submitted for wallet ${walletId}`);

        return {
          walletId,
          networkId: normalizedNetworkId,
          from,
          to,
          tokenMint: tokenMint ?? null,
          signature: result.hash ?? null,
          rawTransaction: result.rawTransaction,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to transfer tokens: ${errorMessage}`);
        throw new Error(`Failed to transfer tokens: ${errorMessage}`);
      }
    }

    // ─── Solana path (unchanged) ──────────────────────────────────────────────
    const createAta =
      typeof params.createAssociatedTokenAccount === "boolean" ? params.createAssociatedTokenAccount : true;

    const rpcUrl = resolveSolanaRpcUrl(normalizedNetworkId, rpcUrlOverride);
    const connection = new Connection(rpcUrl, DEFAULT_COMMITMENT);

    const fromAddress = await getSolanaAddress(context, walletId, derivationIndex);
    const fromPubkey = new PublicKey(fromAddress);
    const toPubkey = new PublicKey(params.to);

    logger.info(`Preparing transfer from ${fromAddress} to ${params.to} on ${normalizedNetworkId}`);

    try {
      const tx = new Transaction();

      if (!tokenMint) {
        const lamports =
          amountUnit === "base" ? parseBaseUnitAmount(amount) : parseUiAmount(amount, 9 /* SOL decimals */);

        requirePositiveAmount(lamports);

        tx.add(
          SystemProgram.transfer({
            fromPubkey,
            toPubkey,
            lamports,
          }),
        );
      } else {
        const mintPubkey = new PublicKey(tokenMint);
        const sourceAta = await getAssociatedTokenAddress(mintPubkey, fromPubkey, false);
        const destinationAta = await getAssociatedTokenAddress(mintPubkey, toPubkey, false);

        const sourceInfo = await connection.getAccountInfo(sourceAta, DEFAULT_COMMITMENT);
        if (!sourceInfo) {
          throw new Error("Source associated token account not found for this wallet");
        }

        const destinationInfo = await connection.getAccountInfo(destinationAta, DEFAULT_COMMITMENT);
        if (!destinationInfo) {
          if (createAta) {
            tx.add(createAssociatedTokenAccountInstruction(fromPubkey, destinationAta, toPubkey, mintPubkey));
          } else {
            throw new Error("Destination associated token account does not exist");
          }
        }

        let decimals: number | undefined;
        if (typeof params.decimals === "number") {
          if (!Number.isInteger(params.decimals) || params.decimals < 0) {
            throw new Error("decimals must be a non-negative integer");
          }
          decimals = params.decimals;
        }

        if (amountUnit === "ui" && decimals === undefined) {
          const mintInfo = await getMint(connection, mintPubkey, DEFAULT_COMMITMENT);
          decimals = mintInfo.decimals;
        }

        if (amountUnit === "ui" && decimals === undefined) {
          throw new Error("Unable to determine token decimals");
        }

        const amountBaseUnits =
          amountUnit === "base" ? parseBaseUnitAmount(amount) : parseUiAmount(amount, decimals as number);

        requirePositiveAmount(amountBaseUnits);

        if (amountUnit === "base" || decimals === undefined) {
          tx.add(createTransferInstruction(sourceAta, destinationAta, fromPubkey, amountBaseUnits));
        } else {
          tx.add(
            createTransferCheckedInstruction(
              sourceAta,
              mintPubkey,
              destinationAta,
              fromPubkey,
              amountBaseUnits,
              decimals,
            ),
          );
        }
      }

      const { blockhash } = await connection.getLatestBlockhash(DEFAULT_COMMITMENT);
      tx.feePayer = fromPubkey;
      tx.recentBlockhash = blockhash;

      const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

      // ── Simulate before submitting ─────────────────────────────────────────
      if (!confirmed) {
        logger.info("Running simulation before transfer (confirmed not set)");
        const base58Tx = bs58.encode(serialized);
        const simulation = await runSimulation(
          {
            type: "transaction",
            chainId: normalizeSwapperChainId(normalizedNetworkId),
            userAccount: fromAddress,
            params: { transactions: [base58Tx], method: "signAndSendTransaction" },
          },
          context,
        );
        logger.info("Simulation complete — awaiting user confirmation");
        return { status: "pending_confirmation", simulation };
      }

      const encoded = base64urlEncode(serialized);

      const result = await client.signAndSendTransaction({
        walletId,
        transaction: encoded,
        networkId: normalizedNetworkId as NetworkId,
        derivationIndex,
        account: fromAddress,
      });

      logger.info(`Transfer submitted for wallet ${walletId}`);

      return {
        walletId,
        networkId: normalizedNetworkId,
        from: fromAddress,
        to: params.to,
        tokenMint: tokenMint ?? null,
        signature: result.hash ?? null,
        rawTransaction: result.rawTransaction,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to transfer tokens: ${errorMessage}`);
      throw new Error(`Failed to transfer tokens: ${errorMessage}`);
    }
  },
};
