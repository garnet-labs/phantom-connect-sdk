import { signEvmTypedDataTool } from "./sign-evm-typed-data";

jest.mock("@phantom/parsers", () => ({
  parseEthereumPersonalMessage: jest.fn(),
  validateEip712TypedData: jest.fn(), // no-op by default (valid data)
}));

beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  // Reset validateEip712TypedData to a no-op before each test
  const { validateEip712TypedData } = jest.requireMock("@phantom/parsers");
  validateEip712TypedData.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const makeContext = (overrides: Record<string, unknown> = {}) => ({
  client: {
    ethereumSignTypedData: jest.fn().mockResolvedValue("0xtyped-sig-xyz"),
    ...overrides,
  },
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

const VALID_TYPED_DATA = {
  types: {
    EIP712Domain: [{ name: "name", type: "string" }],
    Mail: [
      { name: "from", type: "string" },
      { name: "to", type: "string" },
    ],
  },
  primaryType: "Mail",
  domain: { name: "Ether Mail" },
  message: { from: "Alice", to: "Bob" },
};

describe("sign_evm_typed_data", () => {
  it("should have correct name and required fields", () => {
    expect(signEvmTypedDataTool.name).toBe("sign_evm_typed_data");
    expect(signEvmTypedDataTool.inputSchema.required).toContain("typedData");
    expect(signEvmTypedDataTool.inputSchema.required).toContain("chainId");
    expect(signEvmTypedDataTool.annotations?.destructiveHint).toBe(false);
  });

  it("should sign typed data and return signature", async () => {
    const ctx = makeContext();
    const result = await signEvmTypedDataTool.handler({ typedData: VALID_TYPED_DATA, chainId: 1 }, ctx as any);

    expect(ctx.client.ethereumSignTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "wallet-1",
        typedData: VALID_TYPED_DATA,
        networkId: "eip155:1",
      }),
    );
    expect(result).toEqual({ signature: "0xtyped-sig-xyz" });
  });

  it("should work on Base (chainId 8453)", async () => {
    const ctx = makeContext();
    await signEvmTypedDataTool.handler({ typedData: VALID_TYPED_DATA, chainId: 8453 }, ctx as any);
    expect(ctx.client.ethereumSignTypedData).toHaveBeenCalledWith(
      expect.objectContaining({ networkId: "eip155:8453" }),
    );
  });

  it("should call validateEip712TypedData with the typedData", async () => {
    const { validateEip712TypedData } = jest.requireMock("@phantom/parsers");
    const ctx = makeContext();
    await signEvmTypedDataTool.handler({ typedData: VALID_TYPED_DATA, chainId: 1 }, ctx as any);
    expect(validateEip712TypedData).toHaveBeenCalledWith(VALID_TYPED_DATA);
  });

  it("should propagate validation errors from validateEip712TypedData", async () => {
    const { validateEip712TypedData } = jest.requireMock("@phantom/parsers");
    validateEip712TypedData.mockImplementation(() => {
      throw new Error("typedData.primaryType must be a non-empty string");
    });

    const ctx = makeContext();
    await expect(
      signEvmTypedDataTool.handler({ typedData: { ...VALID_TYPED_DATA, primaryType: "" }, chainId: 1 }, ctx as any),
    ).rejects.toThrow("typedData.primaryType must be a non-empty string");
  });

  it("should throw for missing chainId", async () => {
    const ctx = makeContext();
    await expect(signEvmTypedDataTool.handler({ typedData: VALID_TYPED_DATA }, ctx as any)).rejects.toThrow();
  });

  it("should throw for unsupported chainId", async () => {
    const ctx = makeContext();
    await expect(
      signEvmTypedDataTool.handler({ typedData: VALID_TYPED_DATA, chainId: 999999 }, ctx as any),
    ).rejects.toThrow("Unsupported chainId");
  });

  it("should propagate signing errors", async () => {
    const ctx = makeContext({
      ethereumSignTypedData: jest.fn().mockRejectedValue(new Error("signing failed")),
    });
    await expect(signEvmTypedDataTool.handler({ typedData: VALID_TYPED_DATA, chainId: 1 }, ctx as any)).rejects.toThrow(
      "Failed to sign EIP-712 typed data: signing failed",
    );
  });

  it("should throw when domain.chainId does not match chainId", async () => {
    const ctx = makeContext();
    await expect(
      signEvmTypedDataTool.handler(
        {
          typedData: { ...VALID_TYPED_DATA, domain: { name: "Ether Mail", chainId: 137 } },
          chainId: 1,
        },
        ctx as any,
      ),
    ).rejects.toThrow("does not match the provided chainId");
  });

  it("should accept when domain.chainId matches chainId", async () => {
    const ctx = makeContext();
    const result = await signEvmTypedDataTool.handler(
      {
        typedData: { ...VALID_TYPED_DATA, domain: { name: "Ether Mail", chainId: 1 } },
        chainId: 1,
      },
      ctx as any,
    );
    expect(result).toEqual({ signature: "0xtyped-sig-xyz" });
  });

  it("should accept when domain.chainId is absent", async () => {
    const ctx = makeContext();
    const result = await signEvmTypedDataTool.handler({ typedData: VALID_TYPED_DATA, chainId: 1 }, ctx as any);
    expect(result).toEqual({ signature: "0xtyped-sig-xyz" });
  });

  it("should use walletId from params when provided", async () => {
    const ctx = makeContext();
    await signEvmTypedDataTool.handler(
      { typedData: VALID_TYPED_DATA, chainId: 1, walletId: "other-wallet" },
      ctx as any,
    );
    expect(ctx.client.ethereumSignTypedData).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: "other-wallet" }),
    );
  });
});
