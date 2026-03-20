import { withdrawFromPerpsTool } from "./withdraw-from-perps";

const mockPerpsClient = { withdraw: jest.fn() };

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
  mockPerpsClient.withdraw.mockResolvedValue({ status: "ok", data: {} });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("withdraw_from_perps", () => {
  it("has correct name and required fields", () => {
    expect(withdrawFromPerpsTool.name).toBe("withdraw_from_perps");
    expect(withdrawFromPerpsTool.inputSchema.required).toContain("amountUsdc");
    expect(withdrawFromPerpsTool.annotations?.destructiveHint).toBe(true);
  });

  it("calls withdraw with the USDC amount", async () => {
    await withdrawFromPerpsTool.handler({ amountUsdc: "50" }, makeContext() as any);
    expect(mockPerpsClient.withdraw).toHaveBeenCalledWith("50");
  });

  it("throws when amountUsdc is missing or invalid", async () => {
    await expect(withdrawFromPerpsTool.handler({}, makeContext() as any)).rejects.toThrow("amountUsdc");
  });

  it("throws for invalid amountUsdc values", async () => {
    for (const bad of ["", "   ", "all", "-50", "0", "abc", "1e5"]) {
      await expect(withdrawFromPerpsTool.handler({ amountUsdc: bad }, makeContext() as any)).rejects.toThrow();
    }
  });

  it("throws when no walletId is available", async () => {
    const ctx = { ...makeContext(), session: { walletId: undefined } };
    await expect(withdrawFromPerpsTool.handler({ amountUsdc: "10" }, ctx as any)).rejects.toThrow(
      "walletId is required",
    );
  });

  it("propagates withdraw errors", async () => {
    mockPerpsClient.withdraw.mockRejectedValue(new Error("Insufficient withdrawable balance"));
    await expect(withdrawFromPerpsTool.handler({ amountUsdc: "9999" }, makeContext() as any)).rejects.toThrow(
      "Insufficient withdrawable balance",
    );
  });
});
