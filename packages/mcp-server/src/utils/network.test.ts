import { NetworkId } from "@phantom/constants";
import { normalizeNetworkId, normalizeSwapperChainId } from "./network";

describe("network utils", () => {
  describe("normalizeNetworkId", () => {
    it.each([
      ["solana:mainnet", NetworkId.SOLANA_MAINNET],
      ["solana:mainnet-beta", NetworkId.SOLANA_MAINNET],
      ["SOLANA:DEVNET", NetworkId.SOLANA_DEVNET],
      ["solana:testnet", NetworkId.SOLANA_TESTNET],
    ])("normalizes %s", (input, expected) => {
      expect(normalizeNetworkId(input)).toBe(expected);
    });

    it("passes through unsupported network IDs", () => {
      expect(normalizeNetworkId("eip155:1")).toBe("eip155:1");
    });
  });

  describe("normalizeSwapperChainId", () => {
    it.each([
      ["solana:mainnet", "solana:101"],
      [NetworkId.SOLANA_MAINNET, "solana:101"],
      ["solana:devnet", "solana:103"],
      [NetworkId.SOLANA_TESTNET, "solana:102"],
    ])("normalizes %s → %s", (input, expected) => {
      expect(normalizeSwapperChainId(input)).toBe(expected);
    });

    it("passes through unknown chain IDs", () => {
      expect(normalizeSwapperChainId("eip155:8453")).toBe("eip155:8453");
    });
  });
});
