/**
 * PerpsClient — Hyperliquid perpetuals trading via Phantom backend.
 *
 * Intentionally decoupled from PhantomClient: takes a plain EVM address and
 * a signTypedData callback so it can be used in any context (MCP server,
 * tests with a mock signer, other wallet backends, etc.).
 */

import type {
  PerpAccountBalance,
  PerpPosition,
  PerpOrder,
  PerpMarket,
  HistoricalOrder,
  FundingActivity,
  OpenPositionParams,
  ClosePositionParams,
  CancelOrderParams,
  UpdateLeverageParams,
  ActionResponse,
  HlOrderAction,
  HlCancelAction,
  HlUpdateLeverageAction,
  Eip712TypedData,
  PerpsLogger,
} from "./types.js";
import { noopLogger } from "./types.js";
import { PerpsApi } from "./api.js";
import type { ApiClient } from "./api.js";
import {
  buildExchangeActionTypedData,
  buildUsdClassTransferTypedData,
  nextNonce,
  splitSignature,
  formatPrice,
  formatSize,
  resolveLimitPrice,
} from "./actions.js";
import { HYPERCORE_MAINNET_CHAIN_ID, MARKET_ORDER_SLIPPAGE } from "./constants.js";
import { assertPositiveDecimalString } from "./validate.js";

export interface PerpsClientOptions {
  /** The wallet's EVM address (0x-prefixed, checksummed or lowercase) */
  evmAddress: string;
  /**
   * Signs EIP-712 typed data and returns the raw hex signature (0x-prefixed, 65 bytes).
   * In the MCP server this is bound to PhantomClient.ethereumSignTypedData().
   */
  signTypedData: (typedData: Eip712TypedData) => Promise<string>;
  /** Optional logger — if provided, all API calls and errors are logged */
  logger?: PerpsLogger;
  /** Shared API client that routes all requests through the proxy */
  apiClient: ApiClient;
}

export class PerpsClient {
  private readonly evmAddress: string;
  private readonly signTypedData: (typedData: Eip712TypedData) => Promise<string>;
  private readonly api: PerpsApi;
  private readonly logger: PerpsLogger;

  constructor(opts: PerpsClientOptions) {
    this.evmAddress = opts.evmAddress.toLowerCase();
    this.signTypedData = opts.signTypedData;
    this.logger = opts.logger ?? noopLogger;
    this.logger.debug(`PerpsClient initialized evmAddress=${this.evmAddress} taker=${this.getUserCaip19()}`);
    this.api = new PerpsApi({
      logger: this.logger,
      apiClient: opts.apiClient,
    });
  }

  // ── Read (no signing) ────────────────────────────────────────────────────

  async getBalance(): Promise<PerpAccountBalance> {
    return this.api.getAccountBalance(this.getUserCaip19());
  }

  async getPositions(): Promise<PerpPosition[]> {
    const { positions } = await this.api.getPositionsAndOpenOrders(this.getUserCaip19());
    return positions;
  }

  async getOpenOrders(): Promise<PerpOrder[]> {
    const { openOrders } = await this.api.getPositionsAndOpenOrders(this.getUserCaip19());
    return openOrders;
  }

  /** Returns all available perp markets. Used by the get_perp_markets MCP tool. */
  async getMarkets(): Promise<PerpMarket[]> {
    return this.api.getAllMarkets();
  }

  async getTradeHistory(): Promise<HistoricalOrder[]> {
    return this.api.getTradeHistory(this.getUserCaip19());
  }

  async getFundingHistory(): Promise<FundingActivity[]> {
    return this.api.getFundingHistory(this.getUserCaip19());
  }

  // ── Write (EIP-712 sign → submit) ────────────────────────────────────────

  async openPosition(params: OpenPositionParams): Promise<ActionResponse> {
    this.logger.info(
      `openPosition market=${params.market} direction=${params.direction} sizeUsd=${params.sizeUsd} leverage=${params.leverage} orderType=${params.orderType} taker=${this.evmAddress}`,
    );
    assertPositiveDecimalString(params.sizeUsd, "sizeUsd");
    const market = await this.findMarket(params.market);
    if (!market) {
      throw new Error(`Market not found: ${params.market}`);
    }

    // Set leverage before placing the order (required by Hyperliquid).
    // Defaults to isolated margin — cross margin shares account balance across positions.
    const leverageAction: HlUpdateLeverageAction = {
      type: "updateLeverage",
      asset: market.assetId,
      isCross: params.marginType === "cross",
      leverage: params.leverage,
    };
    const leverageNonce = nextNonce();
    const leverageTypedData = buildExchangeActionTypedData(leverageAction, leverageNonce);
    const leverageSig = await this.sign(leverageTypedData);
    await this.api.postUpdateLeverage({
      action: leverageAction,
      nonce: leverageNonce,
      signature: leverageSig,
      taker: this.getUserCaip19(),
    });

    const isBuy = params.direction === "long";
    const price = parseFloat(market.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid market price for ${params.market}: ${market.price}`);
    }
    const rawSize = parseFloat(params.sizeUsd) / price;
    if (!Number.isFinite(rawSize) || rawSize <= 0) {
      throw new Error(`Computed order size is invalid (sizeUsd=${params.sizeUsd}, price=${market.price})`);
    }

    const limitPx = resolveLimitPrice(params.orderType, params.limitPrice, price, isBuy, market.szDecimals);

    // Round down so the required margin never exceeds the available balance.
    // Rounding up (ceil) can cause "insufficient margin" rejections from Hyperliquid.
    const factor = Math.pow(10, market.szDecimals);
    const sz = (Math.floor(rawSize * factor) / factor).toFixed(market.szDecimals);
    if (parseFloat(sz) <= 0) {
      throw new Error(`Order size rounds to zero (sizeUsd=${params.sizeUsd}, price=${market.price})`);
    }

    const action: HlOrderAction = {
      type: "order",
      orders: [
        {
          a: market.assetId,
          b: isBuy,
          p: limitPx,
          s: sz,
          r: params.reduceOnly ?? false,
          t: params.orderType === "limit" ? { limit: { tif: "Gtc" } } : { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    };

    const nonce = nextNonce();
    this.logger.debug(`openPosition placing order market=${params.market} sz=${sz} limitPx=${limitPx} nonce=${nonce}`);
    const typedData = buildExchangeActionTypedData(action, nonce);
    const sig = await this.sign(typedData);
    const result = await this.api.postPlaceOrder({ action, nonce, signature: sig, taker: this.getUserCaip19() });
    this.logger.info(`openPosition result status=${result.status}`);
    return { status: result.status, data: result };
  }

  async closePosition(params: ClosePositionParams): Promise<ActionResponse> {
    this.logger.info(
      `closePosition market=${params.market} sizePercent=${params.sizePercent ?? 100} taker=${this.evmAddress}`,
    );
    const [market, positions] = await Promise.all([this.findMarket(params.market), this.getPositions()]);

    if (!market) {
      throw new Error(`Market not found: ${params.market}`);
    }

    const position = positions.find(p => p.coin.trim().toUpperCase() === market.symbol.trim().toUpperCase());
    if (!position) {
      throw new Error(`No open position for market: ${params.market}`);
    }

    const sizePercent = (params.sizePercent ?? 100) / 100;
    const positionSize = Math.abs(parseFloat(position.size));
    if (!Number.isFinite(positionSize) || positionSize <= 0) {
      throw new Error(`Invalid position size for ${params.market}: ${position.size}`);
    }
    const sizeToClose = positionSize * sizePercent;
    const sz = formatSize(sizeToClose, market.szDecimals);
    if (parseFloat(sz) <= 0) {
      throw new Error(`Close size rounds to zero (size=${position.size}, sizePercent=${params.sizePercent ?? 100})`);
    }

    const isBuy = position.direction === "short"; // close long = sell, close short = buy
    const price = parseFloat(market.price);
    const limitPx = formatPrice(
      price * (isBuy ? 1 + MARKET_ORDER_SLIPPAGE : 1 - MARKET_ORDER_SLIPPAGE),
      market.szDecimals,
    );

    const action: HlOrderAction = {
      type: "order",
      orders: [{ a: market.assetId, b: isBuy, p: limitPx, s: sz, r: true, t: { limit: { tif: "Ioc" } } }],
      grouping: "na",
    };

    const nonce = nextNonce();
    this.logger.debug(
      `closePosition placing order market=${params.market} direction=${position.direction} sz=${sz} limitPx=${limitPx} nonce=${nonce}`,
    );
    const typedData = buildExchangeActionTypedData(action, nonce);
    const sig = await this.sign(typedData);
    const result = await this.api.postPlaceOrder({ action, nonce, signature: sig, taker: this.getUserCaip19() });
    this.logger.info(`closePosition result status=${result.status}`);
    return { status: result.status, data: result };
  }

  async cancelOrder(params: CancelOrderParams): Promise<ActionResponse> {
    this.logger.info(`cancelOrder market=${params.market} orderId=${params.orderId} taker=${this.evmAddress}`);
    const market = await this.findMarket(params.market);
    if (!market) {
      throw new Error(`Market not found: ${params.market}`);
    }

    const action: HlCancelAction = {
      type: "cancel",
      cancels: [{ a: market.assetId, o: params.orderId }],
    };

    const nonce = nextNonce();
    const typedData = buildExchangeActionTypedData(action, nonce);
    const sig = await this.sign(typedData);
    const result = await this.api.postCancelOrder({ action, nonce, signature: sig, taker: this.getUserCaip19() });
    this.logger.info(`cancelOrder result status=${result.status}`);
    return { status: "ok", data: result };
  }

  async updateLeverage(params: UpdateLeverageParams): Promise<ActionResponse> {
    this.logger.info(
      `updateLeverage market=${params.market} leverage=${params.leverage} marginType=${params.marginType} taker=${this.evmAddress}`,
    );
    const market = await this.findMarket(params.market);
    if (!market) {
      throw new Error(`Market not found: ${params.market}`);
    }

    const action: HlUpdateLeverageAction = {
      type: "updateLeverage",
      asset: market.assetId,
      isCross: params.marginType === "cross",
      leverage: params.leverage,
    };

    const nonce = nextNonce();
    const typedData = buildExchangeActionTypedData(action, nonce);
    const sig = await this.sign(typedData);
    const result = await this.api.postUpdateLeverage({ action, nonce, signature: sig, taker: this.getUserCaip19() });
    return { status: "ok", data: result };
  }

  /**
   * Moves USDC from the Hyperliquid spot account to the perps account.
   * Both accounts are on Hypercore — this is NOT a cross-chain bridge.
   */
  async deposit(amountUsdc: string): Promise<ActionResponse> {
    this.logger.info(`deposit amountUsdc=${amountUsdc} taker=${this.evmAddress}`);
    assertPositiveDecimalString(amountUsdc, "amountUsdc");
    const nonce = nextNonce();
    const action = {
      type: "usdClassTransfer" as const,
      hyperliquidChain: "Mainnet" as const,
      signatureChainId: "0xa4b1" as const,
      amount: amountUsdc,
      toPerp: true,
      nonce,
    };

    const typedData = buildUsdClassTransferTypedData(action);
    const sig = await this.sign(typedData);
    const result = await this.api.postTransferUsdcSpotPerp({ action, nonce, signature: sig });
    return { status: "ok", data: result };
  }

  /**
   * Moves USDC from the perps account back to the Hyperliquid spot account.
   */
  async withdraw(amountUsdc: string): Promise<ActionResponse> {
    this.logger.info(`withdraw amountUsdc=${amountUsdc} taker=${this.evmAddress}`);
    assertPositiveDecimalString(amountUsdc, "amountUsdc");
    const nonce = nextNonce();
    const action = {
      type: "usdClassTransfer" as const,
      hyperliquidChain: "Mainnet" as const,
      signatureChainId: "0xa4b1" as const,
      amount: amountUsdc,
      toPerp: false,
      nonce,
    };

    const typedData = buildUsdClassTransferTypedData(action);
    const sig = await this.sign(typedData);
    const result = await this.api.postTransferUsdcSpotPerp({ action, nonce, signature: sig });
    return { status: "ok", data: result };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Fetches a single market by symbol (e.g. "BTC") using its CAIP-19 token address.
   * More efficient than fetching all markets when only one is needed.
   */
  private async findMarket(symbol: string): Promise<PerpMarket> {
    const caip19 = `${HYPERCORE_MAINNET_CHAIN_ID}/address:${symbol.toUpperCase()}`;
    const markets = await this.api.getMarkets([caip19]);
    const market = markets.find(m => m.symbol.toUpperCase() === symbol.toUpperCase());
    if (!market) throw new Error(`Market not found: ${symbol}`);
    return market;
  }

  private getUserCaip19(): string {
    return `${HYPERCORE_MAINNET_CHAIN_ID}/address:${this.evmAddress}`;
  }

  private async sign(typedData: Eip712TypedData): Promise<ReturnType<typeof splitSignature>> {
    const signature = await this.signTypedData(typedData);
    return splitSignature(signature);
  }
}
