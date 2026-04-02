import { getConnectionStatusTool } from "./get-connection-status";

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe("get_connection_status", () => {
  it("returns connected=true with wallet and organization", async () => {
    const result = await getConnectionStatusTool.handler({}, {
      session: { walletId: "wallet-1", organizationId: "org-1" },
      logger,
    } as any);

    expect(result).toEqual({
      connected: true,
      walletId: "wallet-1",
      organizationId: "org-1",
    });
  });

  it("returns connected=false when session is missing wallet fields", async () => {
    const result = await getConnectionStatusTool.handler({}, {
      session: { walletId: "", organizationId: "" },
      logger,
    } as any);

    expect(result).toEqual({
      connected: false,
      reason: "No active session found. Call get_wallet_addresses to authenticate.",
    });
  });
});
