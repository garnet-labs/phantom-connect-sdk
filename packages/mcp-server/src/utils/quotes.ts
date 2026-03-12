/**
 * Types for the Phantom Quotes API response shapes.
 *
 * The backend returns three distinct quote structures depending on the swap type:
 *   - SolanaQuote:          same-chain Solana swap
 *   - EvmSameChainQuote:    same-chain EVM swap (e.g. ETH → USDC on Base)
 *   - CrossChainQuote:      cross-chain swap in either direction (Solana↔EVM)
 *
 * Cross-chain quotes always have a `steps` array. The shape of each step differs
 * depending on whether the sell chain is Solana or EVM.
 */

export type StepTool = {
  key?: string;
  name: string;
  logoURI?: string;
};

/**
 * Same-chain Solana swap quote.
 * `transactionData` may be a single encoded tx or a one-element array.
 */
export type SolanaQuote = {
  transactionData: string | string[];
  sellAmount: string;
  buyAmount: string;
};

/**
 * Same-chain EVM swap quote.
 * `transactionData` may be a single hex calldata string or a one-element array
 * (some providers return an array; both are supported).
 * `gas` may be absent for some providers — callers should fall back to eth_estimateGas.
 */
export type EvmSameChainQuote = {
  transactionData: string | string[];
  exchangeAddress: string;
  value: string;
  gas?: number;
  sellAmount: string;
  buyAmount: string;
};

/**
 * A single step in a cross-chain quote where the sell side is Solana.
 * Only the encoded transaction is needed to initiate the bridge.
 */
export type SolanaOriginCrossChainStep = {
  transactionData: string;
  chainId: string;
  tool: StepTool;
};

/**
 * A single step in a cross-chain quote where the sell side is EVM.
 * Contains all fields needed to build and sign the EVM initiation transaction.
 * `gasCosts` may be absent for some bridge providers (e.g. deBridge) —
 * callers should fall back to eth_estimateGas when it is missing.
 */
export type EvmOriginCrossChainStep = {
  transactionData: string;
  exchangeAddress: string;
  value: string;
  gasCosts?: number[];
  chainId: string;
  tool: StepTool;
};

/**
 * Cross-chain quote (Solana↔EVM in either direction).
 * Always has a `steps` array; the client only signs `steps[0]` to initiate the bridge.
 */
export type CrossChainQuote = {
  steps: (SolanaOriginCrossChainStep | EvmOriginCrossChainStep)[];
  sellAmount: string;
  buyAmount: string;
};

/** Union of all possible quote shapes returned by the Phantom Quotes API. */
export type PhantomQuote = SolanaQuote | EvmSameChainQuote | CrossChainQuote;

/** Top-level response from the Phantom Quotes API. */
export type PhantomQuotesResponse = {
  quotes: PhantomQuote[];
};
