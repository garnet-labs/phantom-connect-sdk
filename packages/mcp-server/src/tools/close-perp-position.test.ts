import { closePerpPositionTool } from "./close-perp-position";

const mockPerpsClient = { closePosition: jest.fn() };

jest.mock("../utils/perps.js", () => ({ createPerpsClient: jest.fn() }));

const makeContext = () => ({
  client: {},
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

beforeEach(() => {
  jest.clearAllMocks();
  const { createPerpsClient } = jest.requireMock("../utils/perps.js");
  (createPerpsClient as jest.Mock).mockResolvedValue(mockPerpsClient);
  mockPerpsClient.closePosition.mockResolvedValue({ status: "ok", data: {} });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("close_perp_position", () => {
  it("has correct name and destructive annotation", () => {
    expect(closePerpPositionTool.name).toBe("close_perp_position");
    expect(closePerpPositionTool.annotations?.destructiveHint).toBe(true);
    expect(closePerpPositionTool.inputSchema.required).toContain("market");
  });

  it("calls closePosition with market and no sizePercent by default", async () => {
    await closePerpPositionTool.handler({ market: "BTC" }, makeContext() as any);
    expect(mockPerpsClient.closePosition).toHaveBeenCalledWith({ market: "BTC", sizePercent: undefined });
  });

  it("passes sizePercent when provided", async () => {
    await closePerpPositionTool.handler({ market: "ETH", sizePercent: 50 }, makeContext() as any);
    expect(mockPerpsClient.closePosition).toHaveBeenCalledWith({ market: "ETH", sizePercent: 50 });
  });

  it("throws when market is missing or whitespace-only", async () => {
    await expect(closePerpPositionTool.handler({}, makeContext() as any)).rejects.toThrow("market is required");
    await expect(closePerpPositionTool.handler({ market: "   " }, makeContext() as any)).rejects.toThrow(
      "market is required",
    );
  });

  it("throws for invalid sizePercent values", async () => {
    await expect(
      closePerpPositionTool.handler({ market: "BTC", sizePercent: 0 }, makeContext() as any),
    ).rejects.toThrow("sizePercent must be a number between 1 and 100");
    await expect(
      closePerpPositionTool.handler({ market: "BTC", sizePercent: 101 }, makeContext() as any),
    ).rejects.toThrow("sizePercent must be a number between 1 and 100");
    await expect(
      closePerpPositionTool.handler({ market: "BTC", sizePercent: NaN }, makeContext() as any),
    ).rejects.toThrow("sizePercent must be a number between 1 and 100");
    await expect(
      closePerpPositionTool.handler({ market: "BTC", sizePercent: Infinity }, makeContext() as any),
    ).rejects.toThrow("sizePercent must be a number between 1 and 100");
  });

  it("throws when no walletId is available", async () => {
    const ctx = { ...makeContext(), session: { walletId: undefined } };
    await expect(closePerpPositionTool.handler({ market: "BTC" }, ctx as any)).rejects.toThrow("walletId is required");
  });

  it("propagates errors from closePosition", async () => {
    mockPerpsClient.closePosition.mockRejectedValue(new Error("No open position for market: BTC"));
    await expect(closePerpPositionTool.handler({ market: "BTC" }, makeContext() as any)).rejects.toThrow(
      "No open position for market: BTC",
    );
  });
});
