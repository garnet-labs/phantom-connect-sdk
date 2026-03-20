import { updatePerpLeverageTool } from "./update-perp-leverage";

const mockPerpsClient = { updateLeverage: jest.fn() };

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
  mockPerpsClient.updateLeverage.mockResolvedValue({ status: "ok", data: {} });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const VALID_PARAMS = { market: "BTC", leverage: 10, marginType: "isolated" };

describe("update_perp_leverage", () => {
  it("has correct name, required fields, and destructive annotation", () => {
    expect(updatePerpLeverageTool.name).toBe("update_perp_leverage");
    expect(updatePerpLeverageTool.inputSchema.required).toContain("market");
    expect(updatePerpLeverageTool.inputSchema.required).toContain("leverage");
    expect(updatePerpLeverageTool.inputSchema.required).toContain("marginType");
    expect(updatePerpLeverageTool.annotations?.destructiveHint).toBe(true);
  });

  it("calls updateLeverage with correct params (isolated)", async () => {
    await updatePerpLeverageTool.handler(VALID_PARAMS, makeContext() as any);
    expect(mockPerpsClient.updateLeverage).toHaveBeenCalledWith({
      market: "BTC",
      leverage: 10,
      marginType: "isolated",
    });
  });

  it("calls updateLeverage with cross margin type", async () => {
    await updatePerpLeverageTool.handler({ ...VALID_PARAMS, marginType: "cross" }, makeContext() as any);
    expect(mockPerpsClient.updateLeverage).toHaveBeenCalledWith(expect.objectContaining({ marginType: "cross" }));
  });

  it("throws for invalid marginType", async () => {
    await expect(
      updatePerpLeverageTool.handler({ ...VALID_PARAMS, marginType: "hedge" }, makeContext() as any),
    ).rejects.toThrow("marginType must be 'cross' or 'isolated'");
  });

  it("throws for invalid leverage values", async () => {
    for (const bad of ["ten", NaN, Infinity, 0, -1, 0.5]) {
      await expect(
        updatePerpLeverageTool.handler({ ...VALID_PARAMS, leverage: bad }, makeContext() as any),
      ).rejects.toThrow("leverage must be a finite number >= 1");
    }
  });

  it("throws when market is missing", async () => {
    await expect(
      updatePerpLeverageTool.handler({ leverage: 10, marginType: "cross" }, makeContext() as any),
    ).rejects.toThrow("market is required");
  });

  it("throws when no walletId is available", async () => {
    const ctx = { ...makeContext(), session: { walletId: undefined } };
    await expect(updatePerpLeverageTool.handler(VALID_PARAMS, ctx as any)).rejects.toThrow("walletId is required");
  });
});
