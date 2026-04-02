import { AddressType } from "@phantom/client";
import { getSolanaAddress } from "./solana";

const makeContext = (addresses: Array<{ addressType: string; address: string }>) => ({
  client: {
    getWalletAddresses: jest.fn().mockResolvedValue(addresses),
  },
});

describe("getSolanaAddress", () => {
  it("returns Solana address from AddressType.solana entries", async () => {
    const context = makeContext([{ addressType: AddressType.solana, address: "So1Address" }]);
    const address = await getSolanaAddress(context as any, "wallet-1");
    expect(address).toBe("So1Address");
    expect(context.client.getWalletAddresses).toHaveBeenCalledWith("wallet-1", undefined, undefined);
  });

  it("falls back to lowercase string matching for addressType", async () => {
    const context = makeContext([{ addressType: "SOLANA", address: "So2Address" }]);
    const address = await getSolanaAddress(context as any, "wallet-1", 4);
    expect(address).toBe("So2Address");
    expect(context.client.getWalletAddresses).toHaveBeenCalledWith("wallet-1", undefined, 4);
  });

  it("throws when no Solana address is found", async () => {
    const context = makeContext([{ addressType: "ethereum", address: "0xabc" }]);
    await expect(getSolanaAddress(context as any, "wallet-1")).rejects.toThrow(
      "No Solana address found for this wallet",
    );
  });
});
