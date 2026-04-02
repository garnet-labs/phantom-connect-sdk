import { getTokenAllowanceTool } from "./get-token-allowance";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@phantom/constants", () => ({
  chainIdToNetworkId: jest.fn((id: number) => {
    const map: Record<number, string> = { 1: "eip155:1", 8453: "eip155:8453", 137: "eip155:137" };
    return map[id];
  }),
}));

jest.mock("../utils/evm.js", () => ({
  getEthereumAddress: jest.fn().mockResolvedValue("0xwalletowner00000000000000000000000000000"),
}));

jest.mock("../utils/allowance.js", () => ({
  fetchERC20Allowance: jest.fn().mockResolvedValue(2_066_891n),
}));

jest.mock("../utils/rpc.js", () => ({
  resolveEvmRpcUrl: jest.fn().mockReturnValue("https://rpc.example.com"),
}));

// ── Context factory ───────────────────────────────────────────────────────────

const makeContext = (overrides: Record<string, unknown> = {}) => ({
  client: {
    getWalletAddresses: jest.fn().mockResolvedValue([{ addressType: "ethereum", address: "0xwalletowner" }]),
    ...overrides,
  },
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SPENDER = "0x0000000000001ff3684f28c67538d4d072c22734";
const OWNER = "0xee8a534eacb5f81dbd8ad163125dfe5f496b0278";

beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Schema ───────────────────────────────────────────────────────────────────

describe("get_token_allowance — schema", () => {
  it("has the correct name", () => {
    expect(getTokenAllowanceTool.name).toBe("get_token_allowance");
  });

  it("requires chainId, tokenAddress, and spenderAddress", () => {
    expect(getTokenAllowanceTool.inputSchema.required).toEqual(
      expect.arrayContaining(["chainId", "tokenAddress", "spenderAddress"]),
    );
  });

  it("is marked read-only", () => {
    expect(getTokenAllowanceTool.annotations?.readOnlyHint).toBe(true);
    expect(getTokenAllowanceTool.annotations?.destructiveHint).toBe(false);
  });
});

// ── Handler ──────────────────────────────────────────────────────────────────

describe("get_token_allowance — handler", () => {
  it("returns allowance in decimal and hex when ownerAddress is provided", async () => {
    const ctx = makeContext();
    const result = (await getTokenAllowanceTool.handler(
      { chainId: 8453, tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: OWNER },
      ctx as any,
    )) as any;

    expect(result.allowance).toBe("2066891");
    expect(result.allowanceHex).toBe("0x" + 2_066_891n.toString(16));
    expect(result.ownerAddress).toBe(OWNER);
    expect(result.tokenAddress).toBe(TOKEN);
    expect(result.spenderAddress).toBe(SPENDER);
    expect(result.chainId).toBe(8453);
  });

  it("derives ownerAddress from the wallet when not provided", async () => {
    const { getEthereumAddress } = jest.requireMock("../utils/evm.js");
    const ctx = makeContext();

    const result = (await getTokenAllowanceTool.handler(
      { chainId: 8453, tokenAddress: TOKEN, spenderAddress: SPENDER },
      ctx as any,
    )) as any;

    expect(getEthereumAddress).toHaveBeenCalledWith(expect.anything(), "wallet-1", undefined);
    expect(result.ownerAddress).toBe("0xwalletowner00000000000000000000000000000");
  });

  it("passes the correct arguments to fetchERC20Allowance", async () => {
    const { fetchERC20Allowance } = jest.requireMock("../utils/allowance.js");
    const ctx = makeContext();

    await getTokenAllowanceTool.handler(
      { chainId: 8453, tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: OWNER },
      ctx as any,
    );

    expect(fetchERC20Allowance).toHaveBeenCalledWith("https://rpc.example.com", TOKEN, OWNER, SPENDER);
  });

  it("throws for an unsupported chainId", async () => {
    const ctx = makeContext();
    await expect(
      getTokenAllowanceTool.handler({ chainId: 99999, tokenAddress: TOKEN, spenderAddress: SPENDER }, ctx as any),
    ).rejects.toThrow("Unsupported chainId: 99999");
  });

  it("throws when tokenAddress is not a valid EVM address", async () => {
    const ctx = makeContext();
    await expect(
      getTokenAllowanceTool.handler(
        { chainId: 8453, tokenAddress: "not-an-address", spenderAddress: SPENDER },
        ctx as any,
      ),
    ).rejects.toThrow("tokenAddress must be a valid EVM address");
  });

  it("throws when spenderAddress is not a valid EVM address", async () => {
    const ctx = makeContext();
    await expect(
      getTokenAllowanceTool.handler({ chainId: 8453, tokenAddress: TOKEN, spenderAddress: "bad" }, ctx as any),
    ).rejects.toThrow("spenderAddress must be a valid EVM address");
  });

  it("throws when ownerAddress is provided but invalid", async () => {
    const ctx = makeContext();
    await expect(
      getTokenAllowanceTool.handler(
        { chainId: 8453, tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: "bad" },
        ctx as any,
      ),
    ).rejects.toThrow("ownerAddress must be a valid EVM address");
  });

  it("accepts chainId as a decimal string", async () => {
    const ctx = makeContext();
    const result = (await getTokenAllowanceTool.handler(
      { chainId: "8453", tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: OWNER },
      ctx as any,
    )) as any;
    expect(result.chainId).toBe(8453);
  });

  it("accepts chainId as a hex string", async () => {
    const ctx = makeContext();
    const result = (await getTokenAllowanceTool.handler(
      { chainId: "0x2105", tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: OWNER },
      ctx as any,
    )) as any;
    expect(result.chainId).toBe(8453);
  });

  it("returns allowance of 0 correctly", async () => {
    const { fetchERC20Allowance } = jest.requireMock("../utils/allowance.js");
    fetchERC20Allowance.mockResolvedValueOnce(0n);

    const ctx = makeContext();
    const result = (await getTokenAllowanceTool.handler(
      { chainId: 8453, tokenAddress: TOKEN, spenderAddress: SPENDER, ownerAddress: OWNER },
      ctx as any,
    )) as any;

    expect(result.allowance).toBe("0");
    expect(result.allowanceHex).toBe("0x0");
  });
});
