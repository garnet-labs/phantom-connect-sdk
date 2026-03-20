import { getPerpPositionsTool } from "./get-perp-positions";

const mockPerpsClient = { getPositions: jest.fn() };

jest.mock("../utils/perps.js", () => ({ createPerpsClient: jest.fn() }));

const makeContext = () => ({
  client: {},
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

const POSITIONS = [
  {
    coin: "BTC",
    direction: "long",
    size: "0.1",
    margin: "500",
    entryPrice: "50000",
    leverage: { type: "isolated", value: 10 },
    unrealizedPnl: "50",
    liquidationPrice: "45000",
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  const { createPerpsClient } = jest.requireMock("../utils/perps.js");
  (createPerpsClient as jest.Mock).mockResolvedValue(mockPerpsClient);
  mockPerpsClient.getPositions.mockResolvedValue(POSITIONS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("get_perp_positions", () => {
  it("has correct name and readOnly annotation", () => {
    expect(getPerpPositionsTool.name).toBe("get_perp_positions");
    expect(getPerpPositionsTool.annotations?.readOnlyHint).toBe(true);
  });

  it("returns positions list", async () => {
    const result = await getPerpPositionsTool.handler({}, makeContext() as any);
    expect(result).toEqual(POSITIONS);
    expect(mockPerpsClient.getPositions).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when no positions", async () => {
    mockPerpsClient.getPositions.mockResolvedValue([]);
    const result = await getPerpPositionsTool.handler({}, makeContext() as any);
    expect(result).toEqual([]);
  });

  it("throws when no walletId is available", async () => {
    const ctx = { ...makeContext(), session: { walletId: undefined } };
    await expect(getPerpPositionsTool.handler({}, ctx as any)).rejects.toThrow("walletId is required");
  });
});
