import { AddressType } from "@phantom/client";
import { payApiAccessTool } from "./pay-api-access";

jest.mock("@phantom/base64url", () => ({
  base64urlEncode: jest.fn().mockReturnValue("encodedTx"),
}));

const makeContext = (overrides: Record<string, unknown> = {}) => ({
  client: {
    getWalletAddresses: jest.fn().mockResolvedValue([{ addressType: AddressType.solana, address: "So1anaAddress" }]),
    signAndSendTransaction: jest.fn().mockResolvedValue({ hash: "sig123" }),
    ...overrides,
  },
  session: {
    walletId: "wallet-1",
    organizationId: "org-1",
  },
  apiClient: {
    setPaymentSignature: jest.fn(),
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
});

describe("pay_api_access", () => {
  it("has expected schema", () => {
    expect(payApiAccessTool.name).toBe("pay_api_access");
    expect(payApiAccessTool.inputSchema.required).toContain("preparedTx");
  });

  it("signs payment transaction and stores signature", async () => {
    const ctx = makeContext();
    const preparedTx = Buffer.from([1, 2, 3]).toString("base64");

    const result = await payApiAccessTool.handler({ preparedTx }, ctx as any);

    expect(ctx.client.getWalletAddresses).toHaveBeenCalledWith("wallet-1", undefined, undefined);
    expect(ctx.client.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: "wallet-1",
        transaction: "encodedTx",
        account: "So1anaAddress",
      }),
    );
    expect(ctx.apiClient.setPaymentSignature).toHaveBeenCalledWith("sig123");
    expect(result).toEqual(expect.objectContaining({ success: true, signature: "sig123" }));
  });

  it("uses walletId and derivationIndex from params when provided", async () => {
    const ctx = makeContext();
    const preparedTx = Buffer.from([4, 5, 6]).toString("base64");

    await payApiAccessTool.handler(
      {
        preparedTx,
        walletId: "wallet-override",
        derivationIndex: 2,
      },
      ctx as any,
    );

    expect(ctx.client.getWalletAddresses).toHaveBeenCalledWith("wallet-override", undefined, 2);
    expect(ctx.client.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: "wallet-override" }),
    );
  });

  it("throws when preparedTx is missing", async () => {
    const ctx = makeContext();
    await expect(payApiAccessTool.handler({}, ctx as any)).rejects.toThrow("preparedTx is required");
  });

  it("throws when preparedTx decodes to empty bytes", async () => {
    const ctx = makeContext();
    await expect(payApiAccessTool.handler({ preparedTx: "!!!" }, ctx as any)).rejects.toThrow(
      "preparedTx decoded to empty — invalid base64",
    );
  });

  it("throws when no Solana address is available", async () => {
    const ctx = makeContext({
      getWalletAddresses: jest.fn().mockResolvedValue([{ addressType: "ethereum", address: "0xabc" }]),
    });
    const preparedTx = Buffer.from([1]).toString("base64");

    await expect(payApiAccessTool.handler({ preparedTx }, ctx as any)).rejects.toThrow(
      "No Solana address found for this wallet",
    );
  });

  it("throws when signAndSendTransaction returns no hash", async () => {
    const ctx = makeContext({
      signAndSendTransaction: jest.fn().mockResolvedValue({ hash: undefined }),
    });
    const preparedTx = Buffer.from([7]).toString("base64");

    await expect(payApiAccessTool.handler({ preparedTx }, ctx as any)).rejects.toThrow(
      "Transaction submitted but no signature returned",
    );
  });
});
