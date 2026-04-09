import { PerpsApi } from "./api.js";

describe("PerpsApi", () => {
  it("uses the backend-expected RelayV2 bridge provider casing", async () => {
    const apiClient = {
      get: jest.fn().mockResolvedValue({}),
      post: jest.fn(),
    };

    const api = new PerpsApi({ apiClient });
    await api.getBridgeInitialize({
      buyToken: "solana:101/address:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      takerDestination: "solana:101/address:dest",
      sellAmount: "1000000",
      sourceWallet: "hypercore:mainnet/address:0xabc",
    });

    expect(apiClient.get).toHaveBeenCalledWith("/swap/v2/spot/bridge-initialize", {
      params: expect.objectContaining({
        bridgeProvider: "RelayV2",
      }),
    });
  });
});
