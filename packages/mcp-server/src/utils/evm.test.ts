import { resolveEvmRpcUrl, estimateGas, fetchGasPrice, getEthereumAddress, assertEvmAddress } from "./evm";
import { AddressType } from "@phantom/client";

// Suppress stderr logging during tests
beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("assertEvmAddress", () => {
  it("accepts a valid lowercase address", () => {
    expect(() => assertEvmAddress("0xabcdef1234567890abcdef1234567890abcdef12")).not.toThrow();
  });

  it("accepts a valid mixed-case address", () => {
    expect(() => assertEvmAddress("0xAbCdEf1234567890AbCdEf1234567890AbCdEf12")).not.toThrow();
  });

  it("throws for a short hex address", () => {
    expect(() => assertEvmAddress("0xabc123", "to")).toThrow(
      "to must be a valid EVM address (0x-prefixed, 40 hex chars)",
    );
  });

  it("throws for an address without 0x prefix", () => {
    expect(() => assertEvmAddress("abcdef1234567890abcdef1234567890abcdef12", "to")).toThrow(
      "to must be a valid EVM address (0x-prefixed, 40 hex chars)",
    );
  });

  it("throws for an address that is too long", () => {
    expect(() => assertEvmAddress("0xabcdef1234567890abcdef1234567890abcdef1234", "to")).toThrow(
      "to must be a valid EVM address (0x-prefixed, 40 hex chars)",
    );
  });

  it("throws for a non-hex character in the address", () => {
    expect(() => assertEvmAddress("0xGGGGGG1234567890abcdef1234567890abcdef12", "to")).toThrow(
      "to must be a valid EVM address (0x-prefixed, 40 hex chars)",
    );
  });

  it("uses default param name when none supplied", () => {
    expect(() => assertEvmAddress("0xshort")).toThrow(
      "address must be a valid EVM address (0x-prefixed, 40 hex chars)",
    );
  });
});

describe("resolveEvmRpcUrl", () => {
  it("should return a valid https override URL when provided", () => {
    const url = resolveEvmRpcUrl("eip155:1", "https://my-custom-rpc.com");
    expect(url).toBe("https://my-custom-rpc.com");
  });

  it("should return default URL for Ethereum mainnet", () => {
    expect(resolveEvmRpcUrl("eip155:1")).toBe("https://node-proxy.phantom.app/v1/chain/ethereum/network/mainnet");
  });

  it("should return default URL for Base mainnet", () => {
    expect(resolveEvmRpcUrl("eip155:8453")).toBe("https://node-proxy.phantom.app/v1/chain/base/network/mainnet");
  });

  it("should return default URL for Ethereum Sepolia", () => {
    expect(resolveEvmRpcUrl("eip155:11155111")).toBe("https://sepolia.drpc.org");
  });

  it("should return default URL for Base Sepolia", () => {
    expect(resolveEvmRpcUrl("eip155:84532")).toBe("https://sepolia.base.org");
  });

  it("should throw for unsupported networkId with no override", () => {
    expect(() => resolveEvmRpcUrl("eip155:99999")).toThrow('rpcUrl is required for networkId "eip155:99999"');
  });

  it("should throw for override with http: scheme", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "http://my-rpc.com")).toThrow("rpcUrl must use https:");
  });

  it("should throw for override targeting localhost", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "https://localhost/rpc")).toThrow("rpcUrl hostname is not permitted");
  });

  it("should throw for override targeting 127.0.0.1", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "https://127.0.0.1/rpc")).toThrow("rpcUrl hostname is not permitted");
  });

  it("should throw for override targeting private 192.168.x.x range", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "https://192.168.1.100")).toThrow("rpcUrl hostname is not permitted");
  });

  it("should throw for override targeting private 10.x.x.x range", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "https://10.0.0.1")).toThrow("rpcUrl hostname is not permitted");
  });

  it("should throw for override targeting private 172.16-31.x.x range", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "https://172.16.0.1")).toThrow("rpcUrl hostname is not permitted");
  });

  it("should accept a valid https override URL", () => {
    const url = resolveEvmRpcUrl("eip155:1", "https://my-custom-rpc.example.com");
    expect(url).toBe("https://my-custom-rpc.example.com");
  });
});

describe("getEthereumAddress", () => {
  const mockContext = {
    client: {
      getWalletAddresses: jest.fn(),
    },
    session: {} as any,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  } as any;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return the Ethereum address when found by AddressType.ethereum", async () => {
    mockContext.client.getWalletAddresses.mockResolvedValue([
      { addressType: AddressType.ethereum, address: "0xAbC123" },
      { addressType: AddressType.solana, address: "solana-addr" },
    ]);

    const address = await getEthereumAddress(mockContext, "wallet-1");
    expect(address).toBe("0xAbC123");
  });

  it("should fall back to lowercase string match for address type", async () => {
    mockContext.client.getWalletAddresses.mockResolvedValue([{ addressType: "ethereum", address: "0xDef456" }]);

    const address = await getEthereumAddress(mockContext, "wallet-1");
    expect(address).toBe("0xDef456");
  });

  it("should throw if no Ethereum address found", async () => {
    mockContext.client.getWalletAddresses.mockResolvedValue([
      { addressType: AddressType.solana, address: "solana-addr" },
    ]);

    await expect(getEthereumAddress(mockContext, "wallet-1")).rejects.toThrow(
      "No Ethereum address found for this wallet",
    );
  });
});

describe("estimateGas", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return gas estimate with 20% buffer", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: "0x5208" }), // 21000
    });

    const gas = await estimateGas("https://rpc.example.com", { to: "0xabc" });
    // 21000 * 1.2 = 25200 = 0x6270
    expect(gas).toBe("0x6270");
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(estimateGas("https://rpc.example.com", {})).rejects.toThrow("Failed to estimate gas: HTTP 500");
  });

  it("should throw on JSON-RPC error", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: { message: "execution reverted" } }),
    });
    await expect(estimateGas("https://rpc.example.com", {})).rejects.toThrow(
      "Failed to estimate gas: execution reverted",
    );
  });
});

describe("fetchGasPrice", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return gas price hex string", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: "0x4A817C800" }), // 20 gwei
    });

    const gasPrice = await fetchGasPrice("https://rpc.example.com");
    expect(gasPrice).toBe("0x4A817C800");
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    await expect(fetchGasPrice("https://rpc.example.com")).rejects.toThrow("Failed to fetch gas price: HTTP 502");
  });
});
