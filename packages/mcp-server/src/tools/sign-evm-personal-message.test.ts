import { signEvmPersonalMessageTool } from "./sign-evm-personal-message";

jest.mock("@phantom/base64url", () => ({
  stringToBase64url: jest.fn().mockReturnValue("base64url-encoded"),
}));

beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const makeContext = (overrides: Record<string, unknown> = {}) => ({
  client: {
    ethereumSignMessage: jest.fn().mockResolvedValue("0xevm-sig-abc"),
    ...overrides,
  },
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

describe("sign_evm_personal_message", () => {
  it("should have correct name and required fields", () => {
    expect(signEvmPersonalMessageTool.name).toBe("sign_evm_personal_message");
    expect(signEvmPersonalMessageTool.inputSchema.required).toContain("message");
    expect(signEvmPersonalMessageTool.inputSchema.required).toContain("chainId");
    expect(signEvmPersonalMessageTool.annotations?.destructiveHint).toBe(false);
  });

  it("should sign a personal message and return signature", async () => {
    const ctx = makeContext();
    const result = await signEvmPersonalMessageTool.handler({ message: "Hello Ethereum!", chainId: 1 }, ctx as any);

    expect(ctx.client.ethereumSignMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "wallet-1",
        message: "base64url-encoded",
        networkId: "eip155:1",
      }),
    );
    expect(result).toEqual({ signature: "0xevm-sig-abc" });
  });

  it("should work on Base (chainId 8453)", async () => {
    const ctx = makeContext();
    const result = await signEvmPersonalMessageTool.handler({ message: "Hello Base!", chainId: 8453 }, ctx as any);
    expect(ctx.client.ethereumSignMessage).toHaveBeenCalledWith(expect.objectContaining({ networkId: "eip155:8453" }));
    expect(result).toEqual({ signature: "0xevm-sig-abc" });
  });

  it("should accept chainId as a string", async () => {
    const ctx = makeContext();
    const result = await signEvmPersonalMessageTool.handler({ message: "Hello!", chainId: "1" }, ctx as any);
    expect(ctx.client.ethereumSignMessage).toHaveBeenCalledWith(expect.objectContaining({ networkId: "eip155:1" }));
    expect(result).toEqual({ signature: "0xevm-sig-abc" });
  });

  it("should throw for missing message", async () => {
    const ctx = makeContext();
    await expect(signEvmPersonalMessageTool.handler({ chainId: 1 }, ctx as any)).rejects.toThrow(
      "message must be a string",
    );
  });

  it("should throw for missing chainId", async () => {
    const ctx = makeContext();
    await expect(signEvmPersonalMessageTool.handler({ message: "test" }, ctx as any)).rejects.toThrow();
  });

  it("should throw for unsupported chainId", async () => {
    const ctx = makeContext();
    await expect(signEvmPersonalMessageTool.handler({ message: "test", chainId: 999999 }, ctx as any)).rejects.toThrow(
      "Unsupported chainId",
    );
  });

  it("should propagate signing errors", async () => {
    const ctx = makeContext({
      ethereumSignMessage: jest.fn().mockRejectedValue(new Error("KMS error")),
    });
    await expect(signEvmPersonalMessageTool.handler({ message: "test", chainId: 1 }, ctx as any)).rejects.toThrow(
      "Failed to sign EVM personal message: KMS error",
    );
  });
});
