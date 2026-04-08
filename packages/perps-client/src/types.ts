/**
 * Types for Hyperliquid perpetuals trading via Phantom backend.
 */

/**
 * Minimal logger interface — satisfied by the MCP server Logger class
 * or any standard logger (console, pino, etc.).
 */
export interface PerpsLogger {
  info(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/** No-op logger used when no logger is provided */
export const noopLogger: PerpsLogger = {
  info: () => {},
  error: () => {},
  debug: () => {},
};

export interface PerpAccountBalance {
  accountValue: string;
  availableBalance: string;
  availableToTrade: string;
}

export interface PerpPosition {
  coin: string;
  direction: "long" | "short";
  size: string;
  margin: string;
  entryPrice: string;
  leverage: { type: "isolated" | "cross" | "unknown"; value: number };
  unrealizedPnl: string;
  liquidationPrice: string | null;
}

export interface PerpOrder {
  id: string;
  coin: string;
  side: "long" | "short";
  type: "limit" | "take_profit_market" | "stop_market";
  isTrigger: boolean;
  limitPrice: string;
  triggerPrice?: string;
  size: string;
  reduceOnly: boolean;
  timestamp: number;
}

export interface PerpMarket {
  symbol: string;
  assetId: number;
  maxLeverage: number;
  szDecimals: number;
  price: string;
  fundingRate: string;
  openInterest: string;
  volume24h: string;
}

export interface HistoricalOrder {
  id: string;
  coin: string;
  type: string;
  timestamp: number;
  price: string;
  size: string;
  tradeValue: string;
  fee: string;
  closedPnl?: string;
}

export interface FundingActivity {
  /** CAIP-19 encoded transaction ID */
  id?: string;
  type: string;
  /** USDC amount for this deposit or withdrawal */
  amount: string;
  timestamp: number;
}

export interface OpenPositionParams {
  /** Coin symbol e.g. "BTC", "ETH" */
  market: string;
  direction: "long" | "short";
  /** Size in USD */
  sizeUsd: string;
  leverage: number;
  /** Margin type — defaults to "isolated" (safer). Use "cross" to share account balance across positions. */
  marginType?: "isolated" | "cross";
  orderType: "market" | "limit";
  limitPrice?: string;
  reduceOnly?: boolean;
}

export interface ClosePositionParams {
  market: string;
  /** 0-100, defaults to 100 (full close) */
  sizePercent?: number;
}

export interface CancelOrderParams {
  market: string;
  orderId: number;
}

export interface UpdateLeverageParams {
  market: string;
  leverage: number;
  marginType: "cross" | "isolated";
}

export interface ActionResponse {
  status: string;
  data?: unknown;
}

/** Response from cancel-order, update-leverage, and transfer-usdc-spot-perp endpoints. */
export interface HlDefaultResponse {
  status: string;
  response: { type: string };
}

/** Response from cancel-order endpoint. */
export interface HlCancelOrderResponse {
  status: string;
  response: {
    type: string;
    data: { statuses: Array<string | { error: string }> };
  };
}

// Internal types for EIP-712 and action submission

export interface Eip712TypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  primaryType: string;
  types: Record<string, { name: string; type: string }[]>;
  message: Record<string, unknown>;
}

export interface SignatureComponents {
  r: string;
  s: string;
  v: number;
}

// Low-level Hyperliquid order structs (mirrors wallet2's order.ts)

type TimeInForce = "Alo" | "Ioc" | "Gtc";

interface LimitOrderType {
  limit: {
    tif: TimeInForce;
  };
}

interface TriggerOrderType {
  trigger: {
    isMarket: boolean;
    triggerPx: string;
    tpsl: "tp" | "sl";
  };
}

export interface HlOrder {
  a: number; // asset id
  b: boolean; // isBuy
  p: string; // price
  s: string; // size
  r: boolean; // reduceOnly
  t: LimitOrderType | TriggerOrderType;
}

export interface HlOrderAction {
  type: "order";
  orders: HlOrder[];
  grouping: "na";
}

export interface HlCancelAction {
  type: "cancel";
  cancels: { a: number; o: number }[];
}

export interface HlUpdateLeverageAction {
  type: "updateLeverage";
  asset: number;
  isCross: boolean;
  leverage: number;
}

export interface HlUsdClassTransferAction {
  type: "usdClassTransfer";
  hyperliquidChain: "Mainnet" | "Testnet";
  signatureChainId: "0xa4b1" | "0x66eee";
  amount: string;
  toPerp: boolean;
  nonce: number;
}

export type HlAction = HlOrderAction | HlCancelAction | HlUpdateLeverageAction | HlUsdClassTransferAction;

// --- Hyperliquid spot withdrawal via Relay V2 bridge ---

export interface WithdrawFromSpotParams {
  /** Human-readable USDC amount (e.g. "8.0") */
  amountUsdc: string;
  /** Destination chain in CAIP-2 format (e.g. "solana:101", "eip155:8453") */
  destinationChainId: string;
  /** Pre-resolved destination wallet address (Solana base58 or EVM 0x hex) */
  destinationAddress: string;
  /** CAIP-19 token to receive on the destination chain. Defaults to USDC. */
  buyToken?: string;
}

export interface WithdrawFromSpotResult {
  requestId: string;
  details: { amountIn: string; amountOut: string; amountOutUsd?: string };
  checkEndpoint: string;
  execution: unknown;
}

export interface RelayWithdrawalV2Quote {
  requestId: string;
  authorizeStep: {
    id: "authorize";
    domain: { name: string; version: string; chainId: number; verifyingContract: string };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
    postEndpoint: string;
    postBody: Record<string, unknown>;
  };
  depositStep: {
    id: "deposit";
    action: Record<string, unknown>;
    nonce: number;
    eip712Types: Record<string, Array<{ name: string; type: string }>>;
    eip712PrimaryType: string;
    checkEndpoint: string;
  };
  details: { amountIn: string; amountOut: string; amountOutUsd?: string };
}

/** Response from POST /swap/v2/place-order (matches backend OrderResponse DTO) */
export interface HlOrderResponseStatus {
  resting?: { oid: number };
  filled?: { totalSz: string; avgPx: string; oid: number };
  error?: string;
}

export interface HlOrderResponse {
  status: string;
  response: {
    type: string;
    data: {
      statuses: HlOrderResponseStatus[];
    };
  };
  filled?: { totalSz: string; avgPx: string; oid: number };
}
