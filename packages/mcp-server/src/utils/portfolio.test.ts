import { ALL_NETWORKS, resolveNetworks, buildCaip19Addresses } from "./portfolio";

const MOCK_ADDRESSES: Record<string, string> = {
  solana: "H8FpYTgx4Uy9aF9Nk9fCTqKKFLYQ9KfC6UJhMkMDzCBh",
  ethereum: "0x8d8b06e017944f5951418b1182d119a376efb39d",
  bitcoinsegwit: "bc1qkce5fvaxe759yu5xle5axlh8c7durjsx2wfhr9",
  sui: "0x039039cf69a336cb84e4c1dbcb3fa0c3f133d11b8146c6f7ed0d9f6817529a62",
};

describe("resolveNetworks", () => {
  it("returns ALL_NETWORKS when networks is undefined", () => {
    expect(resolveNetworks(undefined)).toEqual(ALL_NETWORKS);
  });

  it("returns ALL_NETWORKS when networks is an empty array", () => {
    expect(resolveNetworks([])).toEqual(ALL_NETWORKS);
  });

  it("returns ALL_NETWORKS when networks is not an array", () => {
    expect(resolveNetworks("solana")).toEqual(ALL_NETWORKS);
    expect(resolveNetworks(42)).toEqual(ALL_NETWORKS);
    expect(resolveNetworks(null)).toEqual(ALL_NETWORKS);
  });

  it("returns the provided networks when valid", () => {
    expect(resolveNetworks(["solana", "base"])).toEqual(["solana", "base"]);
  });

  it("filters out unknown network names", () => {
    expect(resolveNetworks(["solana", "unknown-chain", "base"])).toEqual(["solana", "base"]);
  });

  it("returns empty array if all provided networks are unknown", () => {
    expect(resolveNetworks(["unknown-chain"])).toEqual([]);
  });
});

describe("buildCaip19Addresses", () => {
  it("builds correct CAIP-19 address for solana", () => {
    const result = buildCaip19Addresses(["solana"], MOCK_ADDRESSES);
    expect(result).toEqual([`solana:101/address:${MOCK_ADDRESSES.solana}`]);
  });

  it("builds correct CAIP-19 address for ethereum", () => {
    const result = buildCaip19Addresses(["ethereum"], MOCK_ADDRESSES);
    expect(result).toEqual([`eip155:1/address:${MOCK_ADDRESSES.ethereum}`]);
  });

  it("reuses the ethereum address for all EVM chains", () => {
    const result = buildCaip19Addresses(["ethereum", "base", "polygon", "arbitrum"], MOCK_ADDRESSES);
    expect(result).toEqual([
      `eip155:1/address:${MOCK_ADDRESSES.ethereum}`,
      `eip155:8453/address:${MOCK_ADDRESSES.ethereum}`,
      `eip155:137/address:${MOCK_ADDRESSES.ethereum}`,
      `eip155:42161/address:${MOCK_ADDRESSES.ethereum}`,
    ]);
  });

  it("builds correct CAIP-19 address for bitcoin", () => {
    const result = buildCaip19Addresses(["bitcoin"], MOCK_ADDRESSES);
    expect(result).toEqual([`bip122:000000000019d6689c085ae165831e93/address:${MOCK_ADDRESSES.bitcoinsegwit}`]);
  });

  it("builds correct CAIP-19 address for sui", () => {
    const result = buildCaip19Addresses(["sui"], MOCK_ADDRESSES);
    expect(result).toEqual([`sui:mainnet/address:${MOCK_ADDRESSES.sui}`]);
  });

  it("skips networks with no matching address", () => {
    const result = buildCaip19Addresses(["solana", "sui"], { solana: MOCK_ADDRESSES.solana });
    expect(result).toEqual([`solana:101/address:${MOCK_ADDRESSES.solana}`]);
  });

  it("returns empty array when no addresses match", () => {
    const result = buildCaip19Addresses(["solana"], {});
    expect(result).toEqual([]);
  });

  it("silently skips unknown network names", () => {
    const result = buildCaip19Addresses(["solana", "unknown-chain"], MOCK_ADDRESSES);
    expect(result).toEqual([`solana:101/address:${MOCK_ADDRESSES.solana}`]);
  });

  it("builds addresses for all supported networks", () => {
    const result = buildCaip19Addresses(ALL_NETWORKS, MOCK_ADDRESSES);
    expect(result).toHaveLength(8); // one per network, EVM chains each get their own entry
    expect(result).toContain(`solana:101/address:${MOCK_ADDRESSES.solana}`);
    expect(result).toContain(`eip155:1/address:${MOCK_ADDRESSES.ethereum}`);
    expect(result).toContain(`eip155:8453/address:${MOCK_ADDRESSES.ethereum}`);
    expect(result).toContain(`eip155:137/address:${MOCK_ADDRESSES.ethereum}`);
    expect(result).toContain(`eip155:42161/address:${MOCK_ADDRESSES.ethereum}`);
    expect(result).toContain(`eip155:143/address:${MOCK_ADDRESSES.ethereum}`);
    expect(result).toContain(`bip122:000000000019d6689c085ae165831e93/address:${MOCK_ADDRESSES.bitcoinsegwit}`);
    expect(result).toContain(`sui:mainnet/address:${MOCK_ADDRESSES.sui}`);
  });
});
