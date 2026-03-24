import {
  decodeTransactionData,
  validateTokenAddress,
  buildTokenObject,
  EVM_NATIVE_SLIP44,
  fetchSwapQuote,
} from "./swap";

jest.mock("@solana/web3.js", () => ({
  PublicKey: jest.fn().mockImplementation((key: string) => {
    if (key === "INVALID") throw new Error("Invalid public key");
    return { toBase58: () => key };
  }),
}));

jest.mock("bs58", () => {
  const decode = jest.fn().mockReturnValue(new Uint8Array([1, 2, 3]));
  return { __esModule: true, default: { decode }, decode };
});

beforeEach(() => {
  jest.clearAllMocks();
});

// --- decodeTransactionData ---

describe("decodeTransactionData", () => {
  it("decodes base64 when flag is true", () => {
    const b64 = Buffer.from([10, 20, 30]).toString("base64");
    const result = decodeTransactionData(b64, true);
    expect(result).toEqual(Buffer.from([10, 20, 30]));
  });

  it("throws for empty base64 result", () => {
    expect(() => decodeTransactionData("", true)).toThrow("Failed to decode base64");
  });

  it("tries bs58 first when flag is false/undefined", () => {
    const bs58Mod = jest.requireMock("bs58");
    const decodeFn = bs58Mod.default?.decode ?? bs58Mod.decode;
    decodeFn.mockReturnValue(new Uint8Array([1, 2, 3]));
    const result = decodeTransactionData("base58data", false);
    expect(decodeFn).toHaveBeenCalledWith("base58data");
    expect(result).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("falls back to base64 when bs58 fails", () => {
    const bs58Mod = jest.requireMock("bs58");
    const decodeFn = bs58Mod.default?.decode ?? bs58Mod.decode;
    decodeFn.mockImplementation(() => {
      throw new Error("bad base58");
    });
    const b64 = Buffer.from([5, 6, 7]).toString("base64");
    const result = decodeTransactionData(b64, undefined);
    expect(result).toEqual(Buffer.from([5, 6, 7]));
  });
});

// --- validateTokenAddress ---

describe("validateTokenAddress", () => {
  it("accepts a valid Solana address", () => {
    expect(() =>
      validateTokenAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "solana:101", "token"),
    ).not.toThrow();
  });

  it("rejects an invalid Solana address", () => {
    expect(() => validateTokenAddress("INVALID", "solana:101", "token")).toThrow("valid Solana address");
  });

  it("accepts a valid EVM address", () => {
    expect(() => validateTokenAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "eip155:1", "token")).not.toThrow();
  });

  it("rejects an EVM address without 0x prefix", () => {
    expect(() => validateTokenAddress("a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "eip155:1", "token")).toThrow(
      "valid EVM address",
    );
  });

  it("rejects an EVM address with wrong length", () => {
    expect(() => validateTokenAddress("0xabc", "eip155:1", "token")).toThrow("valid EVM address");
  });

  it("includes param name in error message", () => {
    expect(() => validateTokenAddress("bad", "eip155:1", "buyTokenMint")).toThrow("buyTokenMint must be");
  });
});

// --- buildTokenObject ---

describe("buildTokenObject", () => {
  it("builds Solana native token", () => {
    expect(buildTokenObject("solana:101", undefined, true)).toEqual({
      chainId: "solana:101",
      resourceType: "nativeToken",
      slip44: "501",
    });
  });

  it("builds Solana SPL token", () => {
    expect(buildTokenObject("solana:101", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", false)).toEqual({
      chainId: "solana:101",
      resourceType: "address",
      address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
  });

  it("builds EVM native token with correct slip44", () => {
    expect(buildTokenObject("eip155:1", undefined, true)).toEqual({
      chainId: "eip155:1",
      resourceType: "nativeToken",
      slip44: "60",
    });
    expect(buildTokenObject("eip155:8453", undefined, true)).toEqual({
      chainId: "eip155:8453",
      resourceType: "nativeToken",
      slip44: "8453",
    });
    expect(buildTokenObject("eip155:137", undefined, true)).toEqual({
      chainId: "eip155:137",
      resourceType: "nativeToken",
      slip44: "966",
    });
  });

  it("builds EVM token with lowercase address", () => {
    expect(buildTokenObject("eip155:1", "0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48", false)).toEqual({
      chainId: "eip155:1",
      resourceType: "address",
      address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    });
  });

  it("does not lowercase Solana addresses", () => {
    expect(buildTokenObject("solana:101", "EPjFWdd5", false)).toEqual({
      chainId: "solana:101",
      resourceType: "address",
      address: "EPjFWdd5",
    });
  });

  it("throws for unsupported EVM chain native token", () => {
    expect(() => buildTokenObject("eip155:99999", undefined, true)).toThrow("not configured for chain");
  });

  it("covers all EVM_NATIVE_SLIP44 entries", () => {
    for (const [chainId, slip44] of Object.entries(EVM_NATIVE_SLIP44)) {
      const result = buildTokenObject(chainId, undefined, true);
      expect(result.slip44).toBe(slip44);
    }
  });
});

// --- fetchSwapQuote ---

describe("fetchSwapQuote", () => {
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const mockApiClient = { post: jest.fn() };

  const baseOpts = {
    sellChainId: "solana:101",
    buyChainId: "solana:101",
    sellToken: { chainId: "solana:101", resourceType: "nativeToken", slip44: "501" },
    buyToken: { chainId: "solana:101", resourceType: "address", address: "USDC_MINT" },
    taker: "SolAddress123",
    sellAmount: "1000000",
    apiClient: mockApiClient as any,
    logger: mockLogger as any,
  };

  beforeEach(() => {
    mockApiClient.post.mockResolvedValue({ quotes: [] });
  });

  it("calls apiClient.post with /swap/v2/quotes and correct body", async () => {
    await fetchSwapQuote(baseOpts);

    expect(mockApiClient.post).toHaveBeenCalledTimes(1);
    const [path, body] = mockApiClient.post.mock.calls[0];
    expect(path).toBe("/swap/v2/quotes");
    expect(body.taker).toEqual({ chainId: "solana:101", resourceType: "address", address: "SolAddress123" });
    expect(body.sellToken).toEqual(baseOpts.sellToken);
    expect(body.buyToken).toEqual(baseOpts.buyToken);
    expect(body.sellAmount).toBe("1000000");
  });

  it("includes slippageTolerance in body when provided", async () => {
    await fetchSwapQuote({ ...baseOpts, slippageTolerance: 2.5 });

    const body = mockApiClient.post.mock.calls[0][1];
    expect(body.slippageTolerance).toBe(2.5);
  });

  it("includes cross-chain fields when chains differ", async () => {
    await fetchSwapQuote({
      ...baseOpts,
      buyChainId: "eip155:1",
      takerDestination: { chainId: "eip155:1", resourceType: "address", address: "0xabc" },
      chainAddresses: { "solana:101": "SolAddr", "eip155:1": "0xabc" },
    });

    const body = mockApiClient.post.mock.calls[0][1];
    expect(body.takerDestination).toEqual({ chainId: "eip155:1", resourceType: "address", address: "0xabc" });
    expect(body.chainAddresses).toEqual({ "solana:101": "SolAddr", "eip155:1": "0xabc" });
  });

  it("propagates errors from apiClient", async () => {
    mockApiClient.post.mockRejectedValue(new Error("HTTP 400 — bad request"));

    await expect(fetchSwapQuote(baseOpts)).rejects.toThrow("HTTP 400");
  });

  it("returns quoteRequest and quoteResponse on success", async () => {
    const quoteResponse = { quotes: [{ transactionData: "abc" }] };
    mockApiClient.post.mockResolvedValue(quoteResponse);

    const result = await fetchSwapQuote(baseOpts);
    expect(result.quoteRequest).toHaveProperty("taker");
    expect(result.quoteRequest).toHaveProperty("sellToken");
    expect(result.quoteResponse).toEqual(quoteResponse);
  });
});
