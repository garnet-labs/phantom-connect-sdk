import { signSolanaMessageTool } from "./sign-solana-message";
import { sendSolanaTransactionTool } from "./send-solana-transaction";
import { getWalletAddressesTool } from "./get-wallet-addresses";
import { transferTokensTool } from "./transfer-tokens";
import { buyTokenTool } from "./buy-token";
import type { ToolContext } from "./types";
import { Connection } from "@solana/web3.js";

function createContext(clientOverrides: Record<string, unknown> = {}): ToolContext {
  const client = {
    signUtf8Message: jest.fn().mockResolvedValue("signed-message"),
    signTransaction: jest.fn().mockResolvedValue({ rawTransaction: "signed-tx" }),
    signAndSendTransaction: jest.fn().mockResolvedValue({ hash: "sig-123", rawTransaction: "raw-tx" }),
    getWalletAddresses: jest.fn().mockResolvedValue([]),
    ...clientOverrides,
  };

  const logger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  };

  const apiClient = {
    get: jest.fn().mockResolvedValue({}),
    post: jest.fn().mockResolvedValue({}),
    setPaymentSignature: jest.fn(),
  };

  return {
    client: client as unknown as ToolContext["client"],
    session: {
      walletId: "wallet-123",
      organizationId: "org-123",
      authUserId: "user-123",
      stamperKeys: { publicKey: "pub", secretKey: "sec" },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    logger: logger as unknown as ToolContext["logger"],
    apiClient: apiClient as unknown as ToolContext["apiClient"],
  };
}

describe("derivationIndex coercion", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("coerces string derivationIndex for sign_solana_message", async () => {
    const context = createContext();

    await signSolanaMessageTool.handler(
      {
        message: "hello",
        networkId: "solana:mainnet",
        derivationIndex: "0",
      },
      context,
    );

    const signUtf8Message = context.client.signUtf8Message as jest.Mock;
    expect(signUtf8Message).toHaveBeenCalledWith(
      expect.objectContaining({
        derivationIndex: 0,
      }),
    );
  });

  it("coerces string derivationIndex for send_solana_transaction", async () => {
    const context = createContext({
      getWalletAddresses: jest
        .fn()
        .mockResolvedValue([{ addressType: "solana", address: "11111111111111111111111111111111" }]),
    });
    const validTx = Buffer.from(new Uint8Array([1, 2, 3])).toString("base64");

    await sendSolanaTransactionTool.handler(
      {
        transaction: validTx,
        networkId: "solana:mainnet",
        derivationIndex: "0",
        confirmed: true,
      },
      context,
    );

    const signAndSendTransaction = context.client.signAndSendTransaction as jest.Mock;
    expect(signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        derivationIndex: 0,
      }),
    );
  });

  it("coerces string derivationIndex for get_wallet_addresses", async () => {
    const context = createContext();

    await getWalletAddressesTool.handler(
      {
        derivationIndex: "0",
      },
      context,
    );

    const getWalletAddresses = context.client.getWalletAddresses as jest.Mock;
    expect(getWalletAddresses).toHaveBeenCalledWith("wallet-123", undefined, 0);
  });

  it("coerces string derivationIndex for transfer_tokens", async () => {
    const context = createContext({
      getWalletAddresses: jest
        .fn()
        .mockResolvedValue([{ addressType: "solana", address: "11111111111111111111111111111111" }]),
    });
    jest.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100000,
    });

    await transferTokensTool.handler(
      {
        networkId: "solana:mainnet",
        to: "11111111111111111111111111111111",
        amount: "1",
        amountUnit: "base",
        derivationIndex: "0",
        confirmed: true,
      },
      context,
    );

    const signAndSendTransaction = context.client.signAndSendTransaction as jest.Mock;
    expect(signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        derivationIndex: 0,
      }),
    );
  });

  it("coerces string derivationIndex for buy_token execute flow", async () => {
    const context = createContext();
    // buy_token now routes all quotes through context.apiClient (proxy)
    (context.apiClient.post as jest.Mock).mockResolvedValue({
      quotes: [{ transactionData: ["AA=="] }],
    });

    await buyTokenTool.handler(
      {
        networkId: "solana:mainnet",
        sellTokenIsNative: true,
        buyTokenMint: "So11111111111111111111111111111111111111112",
        amount: "1",
        amountUnit: "base",
        execute: true,
        base64EncodedTx: true,
        taker: "11111111111111111111111111111111",
        derivationIndex: "0",
      },
      context,
    );

    const signAndSendTransaction = context.client.signAndSendTransaction as jest.Mock;
    expect(signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        derivationIndex: 0,
      }),
    );
  });
});
