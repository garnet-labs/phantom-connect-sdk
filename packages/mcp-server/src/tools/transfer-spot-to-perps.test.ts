import { transferSpotToPerpsTool } from "./transfer-spot-to-perps";

const mockPerpsClient = { deposit: jest.fn() };

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
  mockPerpsClient.deposit.mockResolvedValue({ status: "ok", data: {} });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("transfer_spot_to_perps", () => {
  it("has correct name and required fields", () => {
    expect(transferSpotToPerpsTool.name).toBe("transfer_spot_to_perps");
    expect(transferSpotToPerpsTool.inputSchema.required).toContain("amountUsdc");
    expect(transferSpotToPerpsTool.annotations?.destructiveHint).toBe(false);
  });

  it("calls deposit with the USDC amount", async () => {
    await transferSpotToPerpsTool.handler({ amountUsdc: "100" }, makeContext() as any);
    expect(mockPerpsClient.deposit).toHaveBeenCalledWith("100");
  });

  it("throws when amountUsdc is missing or invalid", async () => {
    await expect(transferSpotToPerpsTool.handler({}, makeContext() as any)).rejects.toThrow("amountUsdc");
  });

  it("throws for invalid amountUsdc values", async () => {
    for (const bad of ["", "   ", "all", "-100", "0", "abc", "1e5"]) {
      await expect(transferSpotToPerpsTool.handler({ amountUsdc: bad }, makeContext() as any)).rejects.toThrow();
    }
  });

  it("passes amountUsdc directly to deposit", async () => {
    await transferSpotToPerpsTool.handler({ amountUsdc: "100" }, makeContext() as any);
    expect(mockPerpsClient.deposit).toHaveBeenCalledWith("100");
  });

  it("throws when no walletId is available", async () => {
    const ctx = { ...makeContext(), session: { walletId: undefined } };
    await expect(transferSpotToPerpsTool.handler({ amountUsdc: "50" }, ctx as any)).rejects.toThrow(
      "walletId is required",
    );
  });

  it("propagates deposit errors", async () => {
    mockPerpsClient.deposit.mockRejectedValue(new Error("Insufficient spot balance"));
    await expect(transferSpotToPerpsTool.handler({ amountUsdc: "999999" }, makeContext() as any)).rejects.toThrow(
      "Insufficient spot balance",
    );
  });
});
