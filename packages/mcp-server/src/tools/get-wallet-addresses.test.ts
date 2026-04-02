import { getWalletAddressesTool } from "./get-wallet-addresses";

const makeContext = (overrides: Record<string, unknown> = {}) => ({
  client: {
    getWalletAddresses: jest.fn().mockResolvedValue([
      { addressType: "solana", address: "So1anaAddress" },
      { addressType: "ethereum", address: "0xabc" },
    ]),
    ...overrides,
  },
  session: {
    walletId: "wallet-1",
    organizationId: "org-1",
  },
  apiClient: {},
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
});

describe("get_wallet_addresses", () => {
  it("returns mapped addresses with wallet and organization IDs", async () => {
    const ctx = makeContext();
    const result = await getWalletAddressesTool.handler({}, ctx as any);

    expect(ctx.client.getWalletAddresses).toHaveBeenCalledWith("wallet-1", undefined, undefined);
    expect(result).toEqual({
      walletId: "wallet-1",
      organizationId: "org-1",
      addresses: [
        { addressType: "solana", address: "So1anaAddress" },
        { addressType: "ethereum", address: "0xabc" },
      ],
    });
  });

  it("passes derivationIndex to client when provided", async () => {
    const ctx = makeContext();
    await getWalletAddressesTool.handler({ derivationIndex: 3 }, ctx as any);
    expect(ctx.client.getWalletAddresses).toHaveBeenCalledWith("wallet-1", undefined, 3);
  });

  it("throws wrapped error when wallet lookup fails", async () => {
    const ctx = makeContext({
      getWalletAddresses: jest.fn().mockRejectedValue(new Error("rpc down")),
    });
    await expect(getWalletAddressesTool.handler({}, ctx as any)).rejects.toThrow(
      "Failed to get wallet addresses: rpc down",
    );
  });
});
