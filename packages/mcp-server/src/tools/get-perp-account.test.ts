import { getPerpAccountTool } from "./get-perp-account";

const mockPerpsClient = { getBalance: jest.fn() };

jest.mock("../utils/perps.js", () => ({ createPerpsClient: jest.fn() }));

const makeContext = () => ({
  client: {},
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

const BALANCE = { accountValue: "500.00", availableBalance: "300.00", availableToTrade: "300.00" };

beforeEach(() => {
  jest.clearAllMocks();
  const { createPerpsClient } = jest.requireMock("../utils/perps.js");
  (createPerpsClient as jest.Mock).mockResolvedValue(mockPerpsClient);
  mockPerpsClient.getBalance.mockResolvedValue(BALANCE);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("get_perp_account", () => {
  it("has correct name and readOnly annotation", () => {
    expect(getPerpAccountTool.name).toBe("get_perp_account");
    expect(getPerpAccountTool.annotations?.readOnlyHint).toBe(true);
  });

  it("returns account balance", async () => {
    const result = await getPerpAccountTool.handler({}, makeContext() as any);
    expect(result).toEqual(BALANCE);
    expect(mockPerpsClient.getBalance).toHaveBeenCalledTimes(1);
  });

  it("passes derivationIndex to createPerpsClient", async () => {
    const ctx = makeContext();
    await getPerpAccountTool.handler({ derivationIndex: 2 }, ctx as any);
    const { createPerpsClient } = jest.requireMock("../utils/perps.js");
    expect(createPerpsClient).toHaveBeenCalledWith(ctx, "wallet-1", 2);
  });

  it("throws when no walletId is available", async () => {
    const ctx = { ...makeContext(), session: { walletId: undefined } };
    await expect(getPerpAccountTool.handler({}, ctx as any)).rejects.toThrow("walletId is required");
  });

  it("propagates API errors", async () => {
    mockPerpsClient.getBalance.mockRejectedValue(new Error("balance fetch failed"));
    await expect(getPerpAccountTool.handler({}, makeContext() as any)).rejects.toThrow("balance fetch failed");
  });
});
