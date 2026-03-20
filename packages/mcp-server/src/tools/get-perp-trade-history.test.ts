import { getPerpTradeHistoryTool } from "./get-perp-trade-history";

const mockPerpsClient = { getTradeHistory: jest.fn() };

jest.mock("../utils/perps.js", () => ({ createPerpsClient: jest.fn() }));

const makeContext = () => ({
  client: {},
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

const HISTORY = [
  {
    id: "t1",
    coin: "BTC",
    type: "open",
    timestamp: 1700000000,
    price: "50000",
    size: "0.1",
    tradeValue: "5000",
    fee: "-2.5",
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  const { createPerpsClient } = jest.requireMock("../utils/perps.js");
  (createPerpsClient as jest.Mock).mockResolvedValue(mockPerpsClient);
  mockPerpsClient.getTradeHistory.mockResolvedValue(HISTORY);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("get_perp_trade_history", () => {
  it("has correct name and readOnly annotation", () => {
    expect(getPerpTradeHistoryTool.name).toBe("get_perp_trade_history");
    expect(getPerpTradeHistoryTool.annotations?.readOnlyHint).toBe(true);
  });

  it("returns trade history", async () => {
    const result = await getPerpTradeHistoryTool.handler({}, makeContext() as any);
    expect(result).toEqual(HISTORY);
    expect(mockPerpsClient.getTradeHistory).toHaveBeenCalledTimes(1);
  });

  it("throws when no walletId is available", async () => {
    const ctx = { ...makeContext(), session: { walletId: undefined } };
    await expect(getPerpTradeHistoryTool.handler({}, ctx as any)).rejects.toThrow("walletId is required");
  });
});
