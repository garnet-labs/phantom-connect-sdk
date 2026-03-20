import { getPerpMarketsTool } from "./get-perp-markets";

const mockPerpsClient = {
  getMarkets: jest.fn(),
};

jest.mock("../utils/perps.js", () => ({
  createPerpsClient: jest.fn(),
  createAnonymousPerpsClient: jest.fn(),
}));

const makeContext = (overrides: Record<string, unknown> = {}) => ({
  client: { ...overrides },
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

const MARKETS = [
  {
    symbol: "BTC",
    assetId: 0,
    maxLeverage: 50,
    szDecimals: 5,
    price: "50000",
    fundingRate: "0.0001",
    openInterest: "1000000",
    volume24h: "5000000",
  },
  {
    symbol: "ETH",
    assetId: 1,
    maxLeverage: 25,
    szDecimals: 4,
    price: "3000",
    fundingRate: "0.0002",
    openInterest: "500000",
    volume24h: "2000000",
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  const { createPerpsClient, createAnonymousPerpsClient } = jest.requireMock("../utils/perps.js");
  (createPerpsClient as jest.Mock).mockResolvedValue(mockPerpsClient);
  (createAnonymousPerpsClient as jest.Mock).mockReturnValue(mockPerpsClient);
  mockPerpsClient.getMarkets.mockResolvedValue(MARKETS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("get_perp_markets", () => {
  it("has correct name and readOnly annotation", () => {
    expect(getPerpMarketsTool.name).toBe("get_perp_markets");
    expect(getPerpMarketsTool.annotations?.readOnlyHint).toBe(true);
    expect(getPerpMarketsTool.annotations?.destructiveHint).toBe(false);
  });

  it("returns markets list", async () => {
    const ctx = makeContext();
    const result = await getPerpMarketsTool.handler({}, ctx as any);
    expect(result).toEqual(MARKETS);
    expect(mockPerpsClient.getMarkets).toHaveBeenCalledTimes(1);
  });

  it("uses session walletId when not in params", async () => {
    const ctx = makeContext();
    await getPerpMarketsTool.handler({}, ctx as any);
    const { createPerpsClient } = jest.requireMock("../utils/perps.js");
    expect(createPerpsClient).toHaveBeenCalledWith(ctx, "wallet-1");
  });

  it("uses explicit walletId from params", async () => {
    const ctx = makeContext();
    await getPerpMarketsTool.handler({ walletId: "other-wallet" }, ctx as any);
    const { createPerpsClient } = jest.requireMock("../utils/perps.js");
    expect(createPerpsClient).toHaveBeenCalledWith(ctx, "other-wallet");
  });

  it("uses anonymous client when no walletId is available", async () => {
    const ctx = { ...makeContext(), session: { walletId: undefined } };
    const result = await getPerpMarketsTool.handler({}, ctx as any);
    expect(result).toEqual(MARKETS);
    const { createAnonymousPerpsClient } = jest.requireMock("../utils/perps.js");
    expect(createAnonymousPerpsClient).toHaveBeenCalledWith(ctx);
  });

  it("propagates API errors", async () => {
    mockPerpsClient.getMarkets.mockRejectedValue(new Error("API error"));
    const ctx = makeContext();
    await expect(getPerpMarketsTool.handler({}, ctx as any)).rejects.toThrow("API error");
  });
});
