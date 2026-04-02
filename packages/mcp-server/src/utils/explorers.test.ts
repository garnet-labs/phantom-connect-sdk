import { getExplorerTxUrl } from "./explorers";

describe("getExplorerTxUrl", () => {
  it.each([
    ["solana:101", "sig123", "https://solscan.io/tx/sig123"],
    ["eip155:1", "0xabc", "https://etherscan.io/tx/0xabc"],
    ["eip155:8453", "0xdef", "https://basescan.org/tx/0xdef"],
    ["solana:103", "sigDev", "https://solscan.io/tx/sigDev?cluster=devnet"],
    ["solana:102", "sigTest", "https://solscan.io/tx/sigTest?cluster=testnet"],
  ])("builds explorer URL for %s", (chainId, txHash, expected) => {
    expect(getExplorerTxUrl(chainId, txHash)).toBe(expected);
  });

  it("returns undefined for unsupported chain IDs", () => {
    expect(getExplorerTxUrl("unknown:1", "hash")).toBeUndefined();
  });
});
