import {
  validateHttpsUrl,
  validateRpcUrl,
  resolveSolanaRpcUrl,
  resolveEvmRpcUrl,
  DEFAULT_SOLANA_RPC_URLS,
  DEFAULT_EVM_RPC_URLS,
} from "./rpc";

// --- validateHttpsUrl ---

describe("validateHttpsUrl", () => {
  it("accepts a valid HTTPS URL", () => {
    expect(() => validateHttpsUrl("https://api.phantom.app/swap", "Test")).not.toThrow();
  });

  it("rejects HTTP URLs", () => {
    expect(() => validateHttpsUrl("http://api.phantom.app/swap", "Test")).toThrow("must use HTTPS");
  });

  it("rejects non-URL strings", () => {
    expect(() => validateHttpsUrl("not-a-url", "Test")).toThrow("not valid");
  });

  it("rejects URLs without a hostname", () => {
    expect(() => validateHttpsUrl("https://", "Test")).toThrow("not valid");
  });

  it("includes context name in error message", () => {
    expect(() => validateHttpsUrl("ftp://example.com", "My API")).toThrow("My API URL must use HTTPS");
  });
});

// --- validateRpcUrl ---

describe("validateRpcUrl", () => {
  it("accepts a valid HTTPS URL", () => {
    expect(() => validateRpcUrl("https://my-rpc.example.com")).not.toThrow();
  });

  it("throws for http: scheme", () => {
    expect(() => validateRpcUrl("http://my-rpc.com")).toThrow("rpcUrl must use https:");
  });

  it("throws for an invalid URL", () => {
    expect(() => validateRpcUrl("not-a-url")).toThrow("rpcUrl is not a valid URL");
  });

  it("throws for localhost", () => {
    expect(() => validateRpcUrl("https://localhost/rpc")).toThrow("rpcUrl hostname is not permitted");
  });

  it("throws for 127.0.0.1", () => {
    expect(() => validateRpcUrl("https://127.0.0.1/rpc")).toThrow("rpcUrl hostname is not permitted");
  });

  it("throws for 10.x.x.x", () => {
    expect(() => validateRpcUrl("https://10.0.0.1")).toThrow("rpcUrl hostname is not permitted");
  });

  it("throws for 192.168.x.x", () => {
    expect(() => validateRpcUrl("https://192.168.1.100")).toThrow("rpcUrl hostname is not permitted");
  });

  it("throws for 172.16-31.x.x", () => {
    expect(() => validateRpcUrl("https://172.16.0.1")).toThrow("rpcUrl hostname is not permitted");
  });
});

// --- resolveSolanaRpcUrl ---

describe("resolveSolanaRpcUrl", () => {
  it("returns mainnet default for solana:101", () => {
    expect(resolveSolanaRpcUrl("solana:101")).toBe(DEFAULT_SOLANA_RPC_URLS["solana:101"]);
  });

  it("returns devnet default for solana:103", () => {
    expect(resolveSolanaRpcUrl("solana:103")).toBe(DEFAULT_SOLANA_RPC_URLS["solana:103"]);
  });

  it("returns testnet default for solana:102", () => {
    expect(resolveSolanaRpcUrl("solana:102")).toBe(DEFAULT_SOLANA_RPC_URLS["solana:102"]);
  });

  it("returns override when provided", () => {
    expect(resolveSolanaRpcUrl("solana:101", "https://custom-rpc.com")).toBe("https://custom-rpc.com");
  });

  it("throws for unsupported chain ID without override", () => {
    expect(() => resolveSolanaRpcUrl("solana:999")).toThrow('rpcUrl is required for chainId "solana:999"');
  });

  it("throws if override is not HTTPS", () => {
    expect(() => resolveSolanaRpcUrl("solana:101", "http://insecure-rpc.com")).toThrow("must use HTTPS");
  });
});

// --- resolveEvmRpcUrl ---

describe("resolveEvmRpcUrl", () => {
  it("returns default URL for Ethereum mainnet", () => {
    expect(resolveEvmRpcUrl("eip155:1")).toBe(DEFAULT_EVM_RPC_URLS["eip155:1"]);
  });

  it("returns default URL for Base mainnet", () => {
    expect(resolveEvmRpcUrl("eip155:8453")).toBe(DEFAULT_EVM_RPC_URLS["eip155:8453"]);
  });

  it("returns default URL for Ethereum Sepolia", () => {
    expect(resolveEvmRpcUrl("eip155:11155111")).toBe(DEFAULT_EVM_RPC_URLS["eip155:11155111"]);
  });

  it("returns default URL for Base Sepolia", () => {
    expect(resolveEvmRpcUrl("eip155:84532")).toBe(DEFAULT_EVM_RPC_URLS["eip155:84532"]);
  });

  it("returns override when provided", () => {
    expect(resolveEvmRpcUrl("eip155:1", "https://my-custom-rpc.example.com")).toBe("https://my-custom-rpc.example.com");
  });

  it("throws for unsupported networkId with no override", () => {
    expect(() => resolveEvmRpcUrl("eip155:99999")).toThrow('rpcUrl is required for networkId "eip155:99999"');
  });

  it("throws for override with http: scheme", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "http://my-rpc.com")).toThrow("rpcUrl must use https:");
  });

  it("throws for override targeting localhost", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "https://localhost/rpc")).toThrow("rpcUrl hostname is not permitted");
  });

  it("throws for override targeting 127.0.0.1", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "https://127.0.0.1/rpc")).toThrow("rpcUrl hostname is not permitted");
  });

  it("throws for override targeting private 192.168.x.x range", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "https://192.168.1.100")).toThrow("rpcUrl hostname is not permitted");
  });

  it("throws for override targeting private 10.x.x.x range", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "https://10.0.0.1")).toThrow("rpcUrl hostname is not permitted");
  });

  it("throws for override targeting private 172.16-31.x.x range", () => {
    expect(() => resolveEvmRpcUrl("eip155:1", "https://172.16.0.1")).toThrow("rpcUrl hostname is not permitted");
  });
});
