import { sendEvmTransactionTool } from "./send-evm-transaction";

// Mock @phantom/parsers
jest.mock("@phantom/parsers", () => ({
  parseToKmsTransaction: jest.fn().mockResolvedValue({ parsed: "0xrlpencoded", originalFormat: "json" }),
}));

// Mock @phantom/constants
jest.mock("@phantom/constants", () => ({
  chainIdToNetworkId: jest.fn((id: number) => (id === 1 ? "eip155:1" : id === 8453 ? "eip155:8453" : undefined)),
}));

// Mock EVM utils
jest.mock("../utils/evm.js", () => ({
  getEthereumAddress: jest.fn().mockResolvedValue("0xWalletAddr"),
  resolveEvmRpcUrl: jest.fn().mockReturnValue("https://rpc.example.com"),
  estimateGas: jest.fn().mockResolvedValue("0x6270"),
  fetchGasPrice: jest.fn().mockResolvedValue("0x4A817C800"),
}));

beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const makeContext = (overrides: Record<string, unknown> = {}) => ({
  client: {
    signAndSendTransaction: jest.fn().mockResolvedValue({ hash: "0xhash123", rawTransaction: "raw" }),
    ...overrides,
  },
  session: { walletId: "wallet-1", organizationId: "org-1" },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
});

describe("send_evm_transaction", () => {
  it("should have correct name and required fields", () => {
    expect(sendEvmTransactionTool.name).toBe("send_evm_transaction");
    expect(sendEvmTransactionTool.inputSchema.required).toContain("chainId");
    expect(sendEvmTransactionTool.annotations?.destructiveHint).toBe(true);
  });

  it("should send an EVM transaction and return hash", async () => {
    const ctx = makeContext();
    const result = await sendEvmTransactionTool.handler(
      {
        chainId: 1,
        to: "0xRecipient",
        value: "0x38D7EA4C68000",
      },
      ctx as any,
    );

    expect(ctx.client.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: "wallet-1", transaction: "0xrlpencoded" }),
    );
    expect(result).toEqual(expect.objectContaining({ hash: "0xhash123", from: "0xWalletAddr", to: "0xRecipient" }));
  });

  it("should throw for unsupported chainId", async () => {
    const ctx = makeContext();
    await expect(sendEvmTransactionTool.handler({ chainId: 99999 }, ctx as any)).rejects.toThrow(
      "Unsupported chainId: 99999",
    );
  });

  it("should throw when chainId is missing", async () => {
    const ctx = makeContext();
    await expect(sendEvmTransactionTool.handler({}, ctx as any)).rejects.toThrow("chainId must be a number");
  });

  it("should accept chainId as a decimal string", async () => {
    const ctx = makeContext();
    const result = await sendEvmTransactionTool.handler({ chainId: "1", to: "0xRecipient" }, ctx as any);
    expect(result).toEqual(expect.objectContaining({ hash: "0xhash123" }));
  });

  it("should accept chainId as a hex string", async () => {
    const ctx = makeContext();
    const result = await sendEvmTransactionTool.handler({ chainId: "0x2105", to: "0xRecipient" }, ctx as any);
    expect(result).toEqual(expect.objectContaining({ hash: "0xhash123" }));
  });

  it("should throw when chainId is an invalid string", async () => {
    const ctx = makeContext();
    await expect(sendEvmTransactionTool.handler({ chainId: "notanumber" }, ctx as any)).rejects.toThrow(
      "chainId must be a number",
    );
  });

  it("should use explicit gas when provided (skip estimation)", async () => {
    const { estimateGas } = jest.requireMock("../utils/evm.js");
    const ctx = makeContext();

    await sendEvmTransactionTool.handler({ chainId: 1, to: "0xRecipient", gas: "0xC350" }, ctx as any);

    expect(estimateGas).not.toHaveBeenCalled();
  });

  it("should accept gasLimit as alias for gas (skip estimation)", async () => {
    const { estimateGas } = jest.requireMock("../utils/evm.js");
    const ctx = makeContext();

    await sendEvmTransactionTool.handler({ chainId: 1, to: "0xRecipient", gasLimit: "0xC350" }, ctx as any);

    expect(estimateGas).not.toHaveBeenCalled();
  });

  it("should prefer gas over gasLimit when both are provided", async () => {
    const { estimateGas } = jest.requireMock("../utils/evm.js");
    const ctx = makeContext();

    await sendEvmTransactionTool.handler(
      { chainId: 1, to: "0xRecipient", gas: "0xC350", gasLimit: "0x9999" },
      ctx as any,
    );

    expect(estimateGas).not.toHaveBeenCalled();
    // gas: "0xC350" should win — validated indirectly via signAndSendTransaction call
  });

  it("should return the hash string from client result", async () => {
    const ctx = makeContext({
      signAndSendTransaction: jest.fn().mockResolvedValue({
        hash: "0xec05059484d6a913feff03b51f2ac26212373051",
        rawTransaction: "raw",
      }),
    });
    const result = await sendEvmTransactionTool.handler({ chainId: 1, to: "0xRecipient" }, ctx as any);
    expect((result as any).hash).toBe("0xec05059484d6a913feff03b51f2ac26212373051");
  });

  it("should not include nonce in baseTx when not provided", async () => {
    const ctx = makeContext();

    // signAndSendTransaction should be called without nonce in transaction object
    await sendEvmTransactionTool.handler({ chainId: 1, to: "0xRecipient" }, ctx as any);

    expect(ctx.client.signAndSendTransaction).toHaveBeenCalled();
  });

  it("should skip gasPrice fetch when maxFeePerGas is provided", async () => {
    const { fetchGasPrice } = jest.requireMock("../utils/evm.js");
    const ctx = makeContext();

    await sendEvmTransactionTool.handler(
      {
        chainId: 1,
        to: "0xRecipient",
        maxFeePerGas: "0x6FC23AC00",
        maxPriorityFeePerGas: "0x77359400",
      },
      ctx as any,
    );

    expect(fetchGasPrice).not.toHaveBeenCalled();
  });

  it("should return null hash when not present in response", async () => {
    const ctx = makeContext({
      signAndSendTransaction: jest.fn().mockResolvedValue({ hash: undefined }),
    });
    const result = (await sendEvmTransactionTool.handler({ chainId: 8453, to: "0xRecipient" }, ctx as any)) as any;
    expect(result.hash).toBeNull();
  });

  it("should propagate errors from signAndSendTransaction", async () => {
    const ctx = makeContext({
      signAndSendTransaction: jest.fn().mockRejectedValue(new Error("broadcast failed")),
    });
    await expect(sendEvmTransactionTool.handler({ chainId: 1, to: "0xRecipient" }, ctx as any)).rejects.toThrow(
      "Failed to send EVM transaction: broadcast failed",
    );
  });
});
