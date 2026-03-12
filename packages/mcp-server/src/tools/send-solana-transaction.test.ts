import { sendSolanaTransactionTool } from "./send-solana-transaction";

beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const makeContext = (overrides: Record<string, unknown> = {}) => ({
  client: {
    signAndSendTransaction: jest.fn().mockResolvedValue({ hash: "sig123", rawTransaction: "raw" }),
    getWalletAddresses: jest.fn().mockResolvedValue([{ addressType: "solana", address: "SolAddr1" }]),
    ...overrides,
  },
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

// A minimal valid base64-encoded Solana transaction (a few bytes)
const VALID_BASE64_TX = Buffer.from(new Uint8Array([1, 2, 3, 4, 5])).toString("base64");

describe("send_solana_transaction", () => {
  it("should have correct name and required fields", () => {
    expect(sendSolanaTransactionTool.name).toBe("send_solana_transaction");
    expect(sendSolanaTransactionTool.inputSchema.required).toContain("transaction");
    expect(sendSolanaTransactionTool.inputSchema.required).not.toContain("networkId");
    expect(sendSolanaTransactionTool.annotations?.destructiveHint).toBe(true);
  });

  it("should sign and send a Solana transaction and return signature", async () => {
    const ctx = makeContext();
    const result = await sendSolanaTransactionTool.handler(
      { transaction: VALID_BASE64_TX, networkId: "solana:mainnet" },
      ctx as any,
    );

    expect(ctx.client.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: "wallet-1", networkId: expect.stringContaining("solana") }),
    );
    expect(result).toEqual(expect.objectContaining({ signature: "sig123" }));
  });

  it("should default to solana:mainnet when networkId is omitted", async () => {
    const ctx = makeContext();
    const result = await sendSolanaTransactionTool.handler({ transaction: VALID_BASE64_TX }, ctx as any);
    expect(ctx.client.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ networkId: expect.stringContaining("solana") }),
    );
    expect(result).toEqual(expect.objectContaining({ signature: "sig123" }));
  });

  it("should use walletId from params when provided", async () => {
    const ctx = makeContext();
    await sendSolanaTransactionTool.handler(
      { transaction: VALID_BASE64_TX, networkId: "solana:mainnet", walletId: "custom-wallet" },
      ctx as any,
    );
    expect(ctx.client.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: "custom-wallet" }),
    );
  });

  it("should throw for missing transaction", async () => {
    const ctx = makeContext();
    await expect(sendSolanaTransactionTool.handler({ networkId: "solana:mainnet" }, ctx as any)).rejects.toThrow(
      "transaction must be a string",
    );
  });

  it("should throw for invalid (non-Solana) networkId string", async () => {
    const ctx = makeContext();
    await expect(
      sendSolanaTransactionTool.handler({ transaction: VALID_BASE64_TX, networkId: "eip155:1" }, ctx as any),
    ).rejects.toThrow("send_solana_transaction supports Solana networks only");
  });

  it("should throw for non-Solana networkId", async () => {
    const ctx = makeContext();
    await expect(
      sendSolanaTransactionTool.handler({ transaction: VALID_BASE64_TX, networkId: "eip155:1" }, ctx as any),
    ).rejects.toThrow("send_solana_transaction supports Solana networks only");
  });

  it("should throw for empty transaction string", async () => {
    const ctx = makeContext();
    await expect(
      sendSolanaTransactionTool.handler({ transaction: "", networkId: "solana:mainnet" }, ctx as any),
    ).rejects.toThrow("transaction decoded to empty bytes");
  });

  it("should return null signature when hash is absent", async () => {
    const ctx = makeContext({
      signAndSendTransaction: jest.fn().mockResolvedValue({ hash: undefined, rawTransaction: "raw" }),
    });
    const result = (await sendSolanaTransactionTool.handler(
      { transaction: VALID_BASE64_TX, networkId: "solana:mainnet" },
      ctx as any,
    )) as any;
    expect(result.signature).toBeNull();
  });

  it("should propagate signAndSendTransaction errors", async () => {
    const ctx = makeContext({
      signAndSendTransaction: jest.fn().mockRejectedValue(new Error("network error")),
    });
    await expect(
      sendSolanaTransactionTool.handler({ transaction: VALID_BASE64_TX, networkId: "solana:mainnet" }, ctx as any),
    ).rejects.toThrow("Failed to send Solana transaction: network error");
  });
});
