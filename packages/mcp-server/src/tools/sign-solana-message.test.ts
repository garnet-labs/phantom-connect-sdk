import { signSolanaMessageTool } from "./sign-solana-message";

beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const makeContext = (overrides: Record<string, unknown> = {}) => ({
  client: {
    signUtf8Message: jest.fn().mockResolvedValue("solana-sig-123"),
    ...overrides,
  },
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

describe("sign_solana_message", () => {
  it("should have correct name and required fields", () => {
    expect(signSolanaMessageTool.name).toBe("sign_solana_message");
    expect(signSolanaMessageTool.inputSchema.required).toContain("message");
    expect(signSolanaMessageTool.inputSchema.required).toContain("networkId");
    expect(signSolanaMessageTool.annotations?.destructiveHint).toBe(false);
  });

  it("should sign a message and return the signature", async () => {
    const ctx = makeContext();
    const result = await signSolanaMessageTool.handler(
      { message: "Hello Solana!", networkId: "solana:mainnet" },
      ctx as any,
    );

    expect(ctx.client.signUtf8Message).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "wallet-1",
        message: "Hello Solana!",
        networkId: expect.stringContaining("solana"),
      }),
    );
    expect(result).toEqual({ signature: "solana-sig-123" });
  });

  it("should use walletId from params when provided", async () => {
    const ctx = makeContext();
    await signSolanaMessageTool.handler(
      { message: "test", networkId: "solana:mainnet", walletId: "other-wallet" },
      ctx as any,
    );
    expect(ctx.client.signUtf8Message).toHaveBeenCalledWith(expect.objectContaining({ walletId: "other-wallet" }));
  });

  it("should throw for missing message", async () => {
    const ctx = makeContext();
    await expect(signSolanaMessageTool.handler({ networkId: "solana:mainnet" }, ctx as any)).rejects.toThrow(
      "message must be a string",
    );
  });

  it("should throw for missing networkId", async () => {
    const ctx = makeContext();
    await expect(signSolanaMessageTool.handler({ message: "test" }, ctx as any)).rejects.toThrow(
      "networkId must be a string",
    );
  });

  it("should throw for non-Solana networkId", async () => {
    const ctx = makeContext();
    await expect(signSolanaMessageTool.handler({ message: "test", networkId: "eip155:1" }, ctx as any)).rejects.toThrow(
      "sign_solana_message supports Solana networks only",
    );
  });

  it("should propagate signing errors", async () => {
    const ctx = makeContext({
      signUtf8Message: jest.fn().mockRejectedValue(new Error("signing failed")),
    });
    await expect(
      signSolanaMessageTool.handler({ message: "test", networkId: "solana:mainnet" }, ctx as any),
    ).rejects.toThrow("Failed to sign Solana message: signing failed");
  });
});
