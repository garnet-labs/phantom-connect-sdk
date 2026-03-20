import { cancelPerpOrderTool } from "./cancel-perp-order";

const mockPerpsClient = { cancelOrder: jest.fn() };

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
  mockPerpsClient.cancelOrder.mockResolvedValue({ status: "ok", data: {} });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("cancel_perp_order", () => {
  it("has correct name and destructive annotation", () => {
    expect(cancelPerpOrderTool.name).toBe("cancel_perp_order");
    expect(cancelPerpOrderTool.annotations?.destructiveHint).toBe(true);
    expect(cancelPerpOrderTool.inputSchema.required).toContain("market");
    expect(cancelPerpOrderTool.inputSchema.required).toContain("orderId");
  });

  it("calls cancelOrder with market and orderId", async () => {
    await cancelPerpOrderTool.handler({ market: "BTC", orderId: 42 }, makeContext() as any);
    expect(mockPerpsClient.cancelOrder).toHaveBeenCalledWith({ market: "BTC", orderId: 42 });
  });

  it("throws when market is missing", async () => {
    await expect(cancelPerpOrderTool.handler({ orderId: 42 }, makeContext() as any)).rejects.toThrow(
      "market is required",
    );
  });

  it("throws when orderId is missing or not a safe integer", async () => {
    await expect(cancelPerpOrderTool.handler({ market: "BTC" }, makeContext() as any)).rejects.toThrow(
      "orderId must be a safe integer",
    );
    await expect(
      cancelPerpOrderTool.handler({ market: "BTC", orderId: "not-a-number" }, makeContext() as any),
    ).rejects.toThrow("orderId must be a safe integer");
    await expect(cancelPerpOrderTool.handler({ market: "BTC", orderId: NaN }, makeContext() as any)).rejects.toThrow(
      "orderId must be a safe integer",
    );
    await expect(
      cancelPerpOrderTool.handler({ market: "BTC", orderId: Infinity }, makeContext() as any),
    ).rejects.toThrow("orderId must be a safe integer");
    await expect(cancelPerpOrderTool.handler({ market: "BTC", orderId: 42.5 }, makeContext() as any)).rejects.toThrow(
      "orderId must be a safe integer",
    );
  });

  it("throws when no walletId is available", async () => {
    const ctx = { ...makeContext(), session: { walletId: undefined } };
    await expect(cancelPerpOrderTool.handler({ market: "BTC", orderId: 1 }, ctx as any)).rejects.toThrow(
      "walletId is required",
    );
  });
});
