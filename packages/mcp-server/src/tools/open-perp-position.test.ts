import { openPerpPositionTool } from "./open-perp-position";

const mockPerpsClient = { openPosition: jest.fn() };

jest.mock("../utils/perps.js", () => ({ createPerpsClient: jest.fn() }));

const makeContext = () => ({
  client: {},
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

const SUCCESS = { status: "ok", data: { statuses: [{ filled: { totalSz: "0.001", avgPx: "50000" } }] } };

beforeEach(() => {
  jest.clearAllMocks();
  const { createPerpsClient } = jest.requireMock("../utils/perps.js");
  (createPerpsClient as jest.Mock).mockResolvedValue(mockPerpsClient);
  mockPerpsClient.openPosition.mockResolvedValue(SUCCESS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const VALID_PARAMS = {
  market: "BTC",
  direction: "long",
  sizeUsd: "100",
  leverage: 10,
  orderType: "market",
};

describe("open_perp_position", () => {
  it("has correct name, required fields, and destructive annotation", () => {
    expect(openPerpPositionTool.name).toBe("open_perp_position");
    expect(openPerpPositionTool.inputSchema.required).toContain("market");
    expect(openPerpPositionTool.inputSchema.required).toContain("direction");
    expect(openPerpPositionTool.inputSchema.required).toContain("sizeUsd");
    expect(openPerpPositionTool.inputSchema.required).toContain("leverage");
    expect(openPerpPositionTool.inputSchema.required).toContain("orderType");
    expect(openPerpPositionTool.annotations?.destructiveHint).toBe(true);
  });

  it("calls openPosition with correct params for a market long", async () => {
    await openPerpPositionTool.handler(VALID_PARAMS, makeContext() as any);
    const { createPerpsClient } = jest.requireMock("../utils/perps.js");
    expect(createPerpsClient).toHaveBeenCalledWith(expect.anything(), "wallet-1", undefined);
    expect(mockPerpsClient.openPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        market: "BTC",
        direction: "long",
        sizeUsd: "100",
        leverage: 10,
        orderType: "market",
      }),
    );
  });

  it("calls openPosition with limitPrice for limit orders", async () => {
    await openPerpPositionTool.handler(
      { ...VALID_PARAMS, orderType: "limit", limitPrice: "48000" },
      makeContext() as any,
    );
    expect(mockPerpsClient.openPosition).toHaveBeenCalledWith(
      expect.objectContaining({ orderType: "limit", limitPrice: "48000" }),
    );
  });

  it("throws when orderType is limit but no limitPrice", async () => {
    await expect(
      openPerpPositionTool.handler({ ...VALID_PARAMS, orderType: "limit" }, makeContext() as any),
    ).rejects.toThrow("limitPrice must be a positive number");
  });

  it("throws for invalid sizeUsd values", async () => {
    await expect(openPerpPositionTool.handler({ ...VALID_PARAMS, sizeUsd: "0" }, makeContext() as any)).rejects.toThrow(
      "sizeUsd must be a positive number",
    );
    await expect(
      openPerpPositionTool.handler({ ...VALID_PARAMS, sizeUsd: "-50" }, makeContext() as any),
    ).rejects.toThrow("sizeUsd must be a positive number");
    await expect(
      openPerpPositionTool.handler({ ...VALID_PARAMS, sizeUsd: "not-a-number" }, makeContext() as any),
    ).rejects.toThrow("sizeUsd must be a positive number");
    await expect(openPerpPositionTool.handler({ ...VALID_PARAMS, sizeUsd: 0 }, makeContext() as any)).rejects.toThrow(
      "sizeUsd must be a positive number",
    );
  });

  it("throws for invalid leverage values", async () => {
    await expect(openPerpPositionTool.handler({ ...VALID_PARAMS, leverage: 0 }, makeContext() as any)).rejects.toThrow(
      "leverage must be a finite number >= 1",
    );
    await expect(openPerpPositionTool.handler({ ...VALID_PARAMS, leverage: -1 }, makeContext() as any)).rejects.toThrow(
      "leverage must be a finite number >= 1",
    );
    await expect(
      openPerpPositionTool.handler({ ...VALID_PARAMS, leverage: NaN }, makeContext() as any),
    ).rejects.toThrow("leverage must be a finite number >= 1");
    await expect(
      openPerpPositionTool.handler({ ...VALID_PARAMS, leverage: Infinity }, makeContext() as any),
    ).rejects.toThrow("leverage must be a finite number >= 1");
  });

  it("throws for invalid limitPrice on limit orders", async () => {
    await expect(
      openPerpPositionTool.handler({ ...VALID_PARAMS, orderType: "limit", limitPrice: "0" }, makeContext() as any),
    ).rejects.toThrow("limitPrice must be a positive number");
    await expect(
      openPerpPositionTool.handler(
        { ...VALID_PARAMS, orderType: "limit", limitPrice: "not-a-price" },
        makeContext() as any,
      ),
    ).rejects.toThrow("limitPrice must be a positive number");
  });

  it("accepts numeric limitPrice for limit orders", async () => {
    await openPerpPositionTool.handler(
      { ...VALID_PARAMS, orderType: "limit", limitPrice: 48000 },
      makeContext() as any,
    );
    expect(mockPerpsClient.openPosition).toHaveBeenCalledWith(
      expect.objectContaining({ orderType: "limit", limitPrice: "48000" }),
    );
  });

  it("throws for invalid direction", async () => {
    await expect(
      openPerpPositionTool.handler({ ...VALID_PARAMS, direction: "sideways" }, makeContext() as any),
    ).rejects.toThrow("direction must be 'long' or 'short'");
  });

  it("throws for invalid orderType", async () => {
    await expect(
      openPerpPositionTool.handler({ ...VALID_PARAMS, orderType: "stop" }, makeContext() as any),
    ).rejects.toThrow("orderType must be 'market' or 'limit'");
  });

  it("throws when market is missing", async () => {
    const { market: _m, ...rest } = VALID_PARAMS;
    await expect(openPerpPositionTool.handler(rest, makeContext() as any)).rejects.toThrow("market is required");
  });

  it("throws when no walletId is available", async () => {
    const ctx = { ...makeContext(), session: { walletId: undefined } };
    await expect(openPerpPositionTool.handler(VALID_PARAMS, ctx as any)).rejects.toThrow("walletId is required");
  });

  it("propagates errors from openPosition", async () => {
    mockPerpsClient.openPosition.mockRejectedValue(new Error("Market not found: XYZ"));
    await expect(
      openPerpPositionTool.handler({ ...VALID_PARAMS, market: "XYZ" }, makeContext() as any),
    ).rejects.toThrow("Market not found: XYZ");
  });

  it("passes reduceOnly when set", async () => {
    await openPerpPositionTool.handler({ ...VALID_PARAMS, reduceOnly: true }, makeContext() as any);
    expect(mockPerpsClient.openPosition).toHaveBeenCalledWith(expect.objectContaining({ reduceOnly: true }));
  });
});
