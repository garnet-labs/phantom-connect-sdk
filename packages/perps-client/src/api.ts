/**
 * Thin HTTP wrapper for Phantom backend perps endpoints.
 * Logs every request URL + params and every error response body.
 */

import axios, { AxiosError } from "axios";
import type {
  PerpAccountBalance,
  PerpPosition,
  PerpOrder,
  PerpMarket,
  HistoricalOrder,
  FundingActivity,
  SignatureComponents,
  HlOrderAction,
  HlCancelAction,
  HlUpdateLeverageAction,
  HlUsdClassTransferAction,
  HlOrderResponse,
  HlDefaultResponse,
  HlCancelOrderResponse,
  PerpsLogger,
} from "./types.js";
import { noopLogger } from "./types.js";

const DEFAULT_PHANTOM_VERSION = "mcp-server";

/** Keys whose values are redacted from debug logs. EVM addresses are public, only signatures are sensitive. */
const SENSITIVE_LOG_KEYS = new Set(["pubkey", "signature", "sig"]);

function sanitizeForLog(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = SENSITIVE_LOG_KEYS.has(k.toLowerCase()) ? "[redacted]" : v;
  }
  return result;
}

export interface PerpsApiOptions {
  baseUrl: string;
  appId?: string;
  logger?: PerpsLogger;
}

export class PerpsApi {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly logger: PerpsLogger;

  constructor(options: PerpsApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.logger = options.logger ?? noopLogger;

    this.headers = {
      "x-phantom-platform": "ext-sdk",
      "x-phantom-client": "mcp",
      "X-Phantom-Version": process.env.PHANTOM_VERSION ?? DEFAULT_PHANTOM_VERSION,
    };
    if (options.appId) {
      this.headers["x-api-key"] = options.appId;
      this.headers["X-App-Id"] = options.appId;
    }
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const safeParams = params ? sanitizeForLog(params as Record<string, unknown>) : undefined;
    const paramStr = safeParams ? `?${new URLSearchParams(safeParams as Record<string, string>).toString()}` : "";
    this.logger.debug(`GET ${url}${paramStr}`);
    try {
      const r = await axios.get<T>(url, { params, headers: this.headers });
      this.logger.debug(`GET ${path} → ${r.status}`);
      return r.data;
    } catch (err) {
      throw this.wrapAxiosError(err, "GET", url);
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const safeBody = body && typeof body === "object" ? sanitizeForLog(body as Record<string, unknown>) : body;
    this.logger.debug(`POST ${url} body=${JSON.stringify(safeBody)}`);
    try {
      const r = await axios.post<T>(url, body, { headers: this.headers });
      this.logger.debug(`POST ${path} → ${r.status}`);
      return r.data;
    } catch (err) {
      throw this.wrapAxiosError(err, "POST", url);
    }
  }

  /**
   * Wraps an AxiosError so the response body is visible in logs and error messages.
   */
  private wrapAxiosError(err: unknown, method: string, url: string): Error {
    if (err instanceof AxiosError) {
      const status = err.response?.status ?? "no-response";
      const body = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      const message = `Phantom API ${method} ${url} failed: HTTP ${status} — ${body}`;
      this.logger.error(message);
      return new Error(message);
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  async getAccountBalance(user: string): Promise<PerpAccountBalance> {
    this.logger.info(`getAccountBalance user=${user}`);
    return this.get<PerpAccountBalance>("/swap/v2/perp/balance", { user });
  }

  async getFundingHistory(user: string): Promise<FundingActivity[]> {
    this.logger.info(`getFundingHistory user=${user}`);
    const data = await this.get<{ depositAndWithdrawals: RawFundingActivity[] }>(
      "/swap/v2/perp/deposits-and-withdrawals",
      { user },
    );
    return data.depositAndWithdrawals.map(mapFundingActivity);
  }

  async getPositionsAndOpenOrders(user: string): Promise<{ positions: PerpPosition[]; openOrders: PerpOrder[] }> {
    this.logger.info(`getPositionsAndOpenOrders user=${user}`);
    const data = await this.get<{ positions: RawPosition[]; openOrders: RawOpenOrder[] }>(
      "/swap/v2/perp/positions-and-open-orders",
      { user },
    );
    return {
      positions: data.positions.map(mapPosition),
      openOrders: data.openOrders.map(mapOpenOrder),
    };
  }

  async getTradeHistory(user: string): Promise<HistoricalOrder[]> {
    this.logger.info(`getTradeHistory user=${user}`);
    const data = await this.get<{ tradeHistory: RawHistoricalOrder[] }>("/swap/v2/perp/trade-history", { user });
    return data.tradeHistory.map(mapHistoricalOrder);
  }

  /**
   * Fetch specific markets by CAIP-19 token address (e.g. "hypercore:mainnet/address:BTC").
   * The backend requires at least one token — this is for targeted lookups.
   */
  async getMarkets(tokens: string[]): Promise<PerpMarket[]> {
    this.logger.info(`getMarkets tokens=${tokens.join(",")}`);
    const data = await this.get<{ markets: RawMarket[] | Record<string, RawMarket> }>("/swap/v2/perp/markets", {
      tokens: tokens.join(","),
    });
    // The API returns either an array or a keyed record depending on version
    const items = Array.isArray(data.markets) ? data.markets : Object.values(data.markets);
    return items.map(mapMarket);
  }

  /**
   * Fetch trending/popular markets (no per-market tokens needed).
   * Requires chainId, sortBy, sortDirection per backend DTO.
   */
  async getTrendingMarkets(): Promise<PerpMarket[]> {
    this.logger.info(`getTrendingMarkets`);
    const data = await this.get<{ trendingMarkets: RawMarket[] }>("/swap/v2/perp/trending-markets", {
      chainId: "hypercore:mainnet",
      sortBy: "trending",
      sortDirection: "desc",
    });
    return (data.trendingMarkets ?? []).map(mapMarket);
  }

  /**
   * Fetch all available markets via the market-lists endpoint.
   * Deduplicates across categories so each market symbol appears once.
   */
  async getAllMarkets(): Promise<PerpMarket[]> {
    this.logger.info(`getAllMarkets`);
    const data = await this.get<Record<string, { markets: RawMarket[] }>>("/swap/v2/perp/market-lists");
    const seen = new Set<string>();
    const markets: PerpMarket[] = [];
    for (const category of Object.values(data)) {
      for (const raw of category.markets ?? []) {
        if (!seen.has(raw.symbol)) {
          seen.add(raw.symbol);
          markets.push(mapMarket(raw));
        }
      }
    }
    return markets;
  }

  /**
   * POST /swap/v2/place-order — place a single order (open/close position).
   * Requires `taker` (user CAIP-19 address) unlike the generic /exchange endpoint.
   */
  async postPlaceOrder(body: {
    action: HlOrderAction;
    nonce: number;
    signature: SignatureComponents;
    taker: string;
  }): Promise<HlOrderResponse> {
    this.logger.info(`postPlaceOrder nonce=${body.nonce} taker=${body.taker}`);
    return this.post<HlOrderResponse>("/swap/v2/place-order", body);
  }

  /**
   * POST /swap/v2/cancel-order — cancel an open order.
   * Requires `taker` (user CAIP-19 address) so the backend can identify the user.
   */
  async postCancelOrder(body: {
    action: HlCancelAction;
    nonce: number;
    signature: SignatureComponents;
    taker: string;
  }): Promise<HlCancelOrderResponse> {
    this.logger.info(`postCancelOrder nonce=${body.nonce} taker=${body.taker}`);
    return this.post<HlCancelOrderResponse>("/swap/v2/cancel-order", body);
  }

  /**
   * POST /swap/v2/perp/update-leverage — update leverage for a market.
   * Requires `taker` (user CAIP-19 address) so the backend can identify the user.
   */
  async postUpdateLeverage(body: {
    action: HlUpdateLeverageAction;
    nonce: number;
    signature: SignatureComponents;
    taker: string;
  }): Promise<HlDefaultResponse> {
    this.logger.info(
      `postUpdateLeverage asset=${body.action.asset} leverage=${body.action.leverage} taker=${body.taker}`,
    );
    return this.post<HlDefaultResponse>("/swap/v2/perp/update-leverage", body);
  }

  async postTransferUsdcSpotPerp(body: {
    action: HlUsdClassTransferAction;
    nonce: number;
    signature: SignatureComponents;
  }): Promise<HlDefaultResponse> {
    this.logger.info(`postTransferUsdcSpotPerp amount=${body.action.amount} toPerp=${body.action.toPerp}`);
    return this.post<HlDefaultResponse>("/swap/v2/transfer-usdc-spot-perp", body);
  }
}

// ── Raw response shapes from Phantom backend ────────────────────────────────

interface RawPosition {
  direction: "long" | "short";
  leverage: string;
  size: string;
  margin: string;
  entryPrice: string;
  fundingPayments?: string;
  market: { token: { address: string; chainId?: string }; logoUri?: string };
  unrealizedPnl: { amount: string; percentage?: string } | null;
  liquidationPrice: string;
}

interface RawOpenOrder {
  id: string;
  market: { token: { address: string } };
  isTrigger?: boolean;
  direction: "long" | "short";
  type: "limit" | "take_profit_market" | "stop_market";
  limitPrice: string;
  triggerPrice?: string;
  size: string;
  reduceOnly: boolean;
  /** Backend sends timestamp as a string. */
  timestamp: string;
}

interface RawHistoricalOrder {
  id: string;
  market: { token: { address: string; chainId?: string }; logoUri?: string; szDecimals?: number };
  type: string;
  timestamp: number;
  price: string;
  size: string;
  tradeValue: string;
  fee: string;
  closedPnl?: string;
}

interface RawMarket {
  symbol: string;
  /** Numeric Hyperliquid asset index — used to construct orders. */
  assetId: number;
  name?: string;
  logoUri?: string;
  maxLeverage: number;
  szDecimals: number;
  price: string;
  fundingRate: string;
  openInterest: string;
  volume24h: string;
}

/** Raw shape of a single deposit-or-withdrawal item from the backend. */
interface RawFundingActivity {
  id: string;
  type: string;
  /** Amount in USDC. */
  usdcAmount: string;
  timestamp: number;
}

function mapPosition(raw: RawPosition): PerpPosition {
  const leverage = parseFloat(raw.leverage);
  return {
    coin: raw.market.token.address,
    direction: raw.direction,
    size: raw.size,
    margin: raw.margin,
    entryPrice: raw.entryPrice,
    leverage: { type: "unknown", value: leverage },
    unrealizedPnl: raw.unrealizedPnl?.amount ?? "0",
    liquidationPrice: raw.liquidationPrice || null,
  };
}

function mapOpenOrder(raw: RawOpenOrder): PerpOrder {
  return {
    id: raw.id,
    coin: raw.market.token.address,
    side: raw.direction,
    type: raw.type,
    isTrigger: raw.isTrigger ?? false,
    limitPrice: raw.limitPrice,
    triggerPrice: raw.triggerPrice,
    size: raw.size,
    reduceOnly: raw.reduceOnly,
    timestamp: parseInt(raw.timestamp, 10),
  };
}

function mapHistoricalOrder(raw: RawHistoricalOrder): HistoricalOrder {
  return {
    id: raw.id,
    coin: raw.market.token.address,
    type: raw.type,
    timestamp: raw.timestamp,
    price: raw.price,
    size: raw.size,
    tradeValue: raw.tradeValue,
    fee: raw.fee,
    closedPnl: raw.closedPnl,
  };
}

function mapMarket(raw: RawMarket): PerpMarket {
  return {
    symbol: raw.symbol,
    assetId: raw.assetId,
    maxLeverage: raw.maxLeverage,
    szDecimals: raw.szDecimals,
    price: raw.price,
    fundingRate: raw.fundingRate,
    openInterest: raw.openInterest,
    volume24h: raw.volume24h,
  };
}

function mapFundingActivity(raw: RawFundingActivity): FundingActivity {
  return {
    id: raw.id,
    type: raw.type,
    amount: raw.usdcAmount,
    timestamp: raw.timestamp,
  };
}
