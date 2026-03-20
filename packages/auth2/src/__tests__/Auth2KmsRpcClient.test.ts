const mockBase64urlEncode = jest.fn((data: Uint8Array) => Buffer.from(data).toString("base64url"));
jest.mock("@phantom/base64url", () => ({
  base64urlEncode: mockBase64urlEncode,
}));

const mockPostKmsRpc = jest.fn();
jest.mock("@phantom/openapi-wallet-service", () => ({
  Configuration: jest.fn().mockImplementation((cfg: unknown) => cfg),
  KMSRPCApi: jest.fn().mockImplementation(() => ({ postKmsRpc: mockPostKmsRpc })),
  GetOrCreatePhantomOrganizationMethodEnum: {
    getOrCreatePhantomOrganization: "getOrCreatePhantomOrganization",
  },
  GetOrganizationWalletsMethodEnum: { getOrganizationWallets: "getOrganizationWallets" },
  GetOrCreateWalletWithTagMethodEnum: { getOrCreateWalletWithTag: "getOrCreateWalletWithTag" },
  DerivationInfoCurveEnum: { ed25519: "ed25519", secp256k1: "secp256k1" },
  DerivationInfoAddressFormatEnum: {
    solana: "solana",
    ethereum: "ethereum",
    bitcoinSegwit: "bitcoinSegwit",
    sui: "sui",
  },
}));

let capturedRequestInterceptor: ((config: Record<string, unknown>) => Promise<Record<string, unknown>>) | null = null;
jest.mock("axios", () => ({
  create: jest.fn(),
}));

import axios from "axios";
import { KMSRPCApi } from "@phantom/openapi-wallet-service";
import { Auth2KmsRpcClient } from "../index";

function makeStamper(
  overrides: Partial<{
    stamp: jest.Mock;
    getKeyInfo: jest.Mock;
    bearerToken: string | null;
    auth2Token: { sub: string } | null;
    init: jest.Mock;
  }> = {},
) {
  return {
    stamp: jest.fn().mockResolvedValue("mock-stamp"),
    getKeyInfo: jest.fn().mockReturnValue({
      keyId: "key-id-1",
      publicKey: "7EcDshMsTHCs2f2HU2a3n36x9JkEVVenF9oQQGy5U3s",
      createdAt: Date.now(),
    }),
    bearerToken: "Bearer mock-token",
    auth2Token: null as { sub: string } | null,
    getCryptoKeyPair: jest.fn().mockReturnValue(null),
    setTokens: jest.fn().mockResolvedValue(undefined),
    init: jest.fn().mockResolvedValue({
      keyId: "key-id-1",
      publicKey: "7EcDshMsTHCs2f2HU2a3n36x9JkEVVenF9oQQGy5U3s",
      createdAt: Date.now(),
    }),
    rotateKeyPair: jest.fn(),
    commitRotation: jest.fn(),
    rollbackRotation: jest.fn(),
    resetKeyPair: jest.fn(),
    clear: jest.fn(),
    algorithm: "ECDSA_P256",
    type: "OIDC" as const,
    ...overrides,
  };
}

describe("Auth2KmsRpcClient", () => {
  const kmsOptions = { apiBaseUrl: "https://kms.example.com", appId: "app-123" };

  function makeAxiosFake() {
    return {
      interceptors: {
        request: {
          use: jest.fn((fn: (config: Record<string, unknown>) => Promise<Record<string, unknown>>) => {
            capturedRequestInterceptor = fn;
          }),
        },
      },
    };
  }

  function makeClient(stamperOverrides = {}) {
    capturedRequestInterceptor = null;
    (axios.create as jest.Mock).mockReturnValueOnce(makeAxiosFake());
    return new Auth2KmsRpcClient(makeStamper(stamperOverrides) as never, kmsOptions);
  }

  beforeEach(() => {
    mockPostKmsRpc.mockReset();
    (axios.create as jest.Mock).mockReturnValue(makeAxiosFake());
    (KMSRPCApi as jest.Mock).mockImplementation(() => ({ postKmsRpc: mockPostKmsRpc }));
  });

  describe("axios request interceptor", () => {
    it("sets x-app-id, x-api-version, and x-phantom-stamp headers", async () => {
      const stamper = makeStamper();
      makeClient(stamper);

      expect(capturedRequestInterceptor).not.toBeNull();

      const config = { data: '{"method":"test"}', headers: {} as Record<string, string> };
      const result = await capturedRequestInterceptor!(config);

      const headers = result["headers"] as Record<string, string>;
      expect(headers["x-app-id"]).toBe("app-123");
      expect(headers["x-api-version"]).toBe("2025-11-24");
      expect(headers["x-phantom-stamp"]).toBe("mock-stamp");
      expect(stamper.stamp).toHaveBeenCalledWith(expect.objectContaining({ data: expect.anything() }));
    });

    it("stamps an empty string body when config.data is undefined", async () => {
      const stamper = makeStamper();
      makeClient(stamper);
      const config = { headers: {} as Record<string, string> };
      await capturedRequestInterceptor!(config);
      expect(stamper.stamp).toHaveBeenCalledWith(expect.objectContaining({ data: expect.anything() }));
    });

    it("sets authorization header from stamper.bearerToken", async () => {
      const stamper = makeStamper({
        bearerToken: "Bearer access-token",
        auth2Token: { sub: "user-id" },
      });
      makeClient(stamper);
      const config = { data: "{}", headers: {} as Record<string, string> };

      const result = await capturedRequestInterceptor!(config);

      const headers = result["headers"] as Record<string, string>;
      expect(headers["authorization"]).toBe("Bearer access-token");
    });

    it("sets x-auth-user-id header when auth2Token.sub is present", async () => {
      const stamper = makeStamper({
        bearerToken: "Bearer access-token",
        auth2Token: { sub: "user-id" },
      });
      makeClient(stamper);
      const config = { data: "{}", headers: {} as Record<string, string> };

      const result = await capturedRequestInterceptor!(config);

      const headers = result["headers"] as Record<string, string>;
      expect(headers["x-auth-user-id"]).toBe("user-id");
    });

    it("omits x-auth-user-id header when auth2Token is null", async () => {
      const stamper = makeStamper({
        bearerToken: "Bearer access-token",
        auth2Token: null,
      });
      makeClient(stamper);
      const config = { data: "{}", headers: {} as Record<string, string> };

      const result = await capturedRequestInterceptor!(config);

      const headers = result["headers"] as Record<string, string>;
      expect(headers["x-auth-user-id"]).toBeUndefined();
    });
  });

  describe("getOrCreatePhantomOrganization", () => {
    it("returns the ExternalKmsOrganization result", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { organizationId: "org-abc" } } });
      const client = makeClient();

      expect(await client.getOrCreatePhantomOrganization("base64url-pubkey")).toEqual({ organizationId: "org-abc" });
    });

    it("sends the publicKey in the RPC params", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { organizationId: "org-abc" } } });
      const client = makeClient();

      await client.getOrCreatePhantomOrganization("my-public-key");

      const request = mockPostKmsRpc.mock.calls[0][0] as {
        method: string;
        params: { publicKey: string };
      };
      expect(request.method).toBe("getOrCreatePhantomOrganization");
      expect(request.params.publicKey).toBe("my-public-key");
    });

    it("throws on KMS-level RPC error (HTTP 200 with error body)", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { error: { code: -32000, message: "Unauthorized" } } });
      const client = makeClient();

      await expect(client.getOrCreatePhantomOrganization("key")).rejects.toThrow("KMS RPC error");
    });
  });

  describe("listPendingMigrations", () => {
    it("returns the raw result object including pendingMigrations", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({
        data: {
          result: {
            pendingMigrations: [{ migrationId: "migration-1" }, { migrationId: "migration-2" }],
          },
        },
      });
      const client = makeClient();

      const result = await client.listPendingMigrations("org-abc");
      expect(result).toEqual({
        pendingMigrations: [{ migrationId: "migration-1" }, { migrationId: "migration-2" }],
      });
    });

    it("returns an empty object when pendingMigrations key is absent", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: {} } });
      const client = makeClient();

      const result = await client.listPendingMigrations("org-abc");
      expect(result).toEqual({});
      expect(result.pendingMigrations).toBeUndefined();
    });

    it("returns an empty pendingMigrations array as-is", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { pendingMigrations: [] } } });
      const client = makeClient();

      const result = await client.listPendingMigrations("org-abc");
      expect(result.pendingMigrations).toEqual([]);
    });

    it("passes organizationId in the RPC request params", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: {} } });
      const client = makeClient();

      await client.listPendingMigrations("org-xyz");

      const request = mockPostKmsRpc.mock.calls[0][0] as { params: { organizationId: string } };
      expect(request.params.organizationId).toBe("org-xyz");
    });

    it("throws on KMS-level RPC error", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { error: { code: -32000, message: "Forbidden" } } });
      const client = makeClient();

      await expect(client.listPendingMigrations("org-abc")).rejects.toThrow("KMS RPC error");
    });
  });

  describe("completeWalletTransfer", () => {
    it("posts completeWalletTransfer RPC with organizationId and migrationId from the args object", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: {} } });
      const client = makeClient();

      await client.completeWalletTransfer({ organizationId: "org-abc", migrationId: "migration-1" });

      const request = mockPostKmsRpc.mock.calls[0][0] as { method: string; params: Record<string, string> };
      expect(request.method).toBe("completeWalletTransfer");
      expect(request.params.organizationId).toBe("org-abc");
      expect(request.params.migrationId).toBe("migration-1");
    });

    it("resolves on success", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: {} } });
      const client = makeClient();

      await expect(
        client.completeWalletTransfer({ organizationId: "org-abc", migrationId: "migration-1" }),
      ).resolves.toBeDefined();
    });

    it("throws on KMS-level RPC error", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { error: { code: -32003, message: "Transfer failed" } } });
      const client = makeClient();

      await expect(
        client.completeWalletTransfer({ organizationId: "org-abc", migrationId: "migration-1" }),
      ).rejects.toThrow("KMS RPC error");
    });
  });

  describe("getOrganizationWallets", () => {
    it("returns the OrganizationWallets result", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({
        data: { result: { wallets: [{ walletId: "w-1", tags: ["vault"] }] } },
      });
      const client = makeClient();

      const result = await client.getOrganizationWallets("org-abc");
      expect(result.wallets).toHaveLength(1);
      expect(result.wallets[0].walletId).toBe("w-1");
    });

    it("passes organizationId, limit=20, and offset=0 in the RPC params", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { wallets: [] } } });
      const client = makeClient();

      await client.getOrganizationWallets("org-abc");

      const request = mockPostKmsRpc.mock.calls[0][0] as {
        method: string;
        params: { organizationId: string; limit: number; offset: number };
      };
      expect(request.method).toBe("getOrganizationWallets");
      expect(request.params.organizationId).toBe("org-abc");
      expect(request.params.limit).toBe(20);
      expect(request.params.offset).toBe(0);
    });

    it("returns an empty wallets array when none exist", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { wallets: [] } } });
      const client = makeClient();

      const result = await client.getOrganizationWallets("org-abc");
      expect(result.wallets).toEqual([]);
    });

    it("makes a second request when the first page is full (length === limit)", async () => {
      const fullPage = Array.from({ length: 20 }, (_, i) => ({ walletId: `w-${i}`, tags: [] }));
      const partialPage = [{ walletId: "w-20", tags: [] }];
      mockPostKmsRpc
        .mockResolvedValueOnce({ data: { result: { wallets: fullPage } } })
        .mockResolvedValueOnce({ data: { result: { wallets: partialPage } } });
      const client = makeClient();

      const result = await client.getOrganizationWallets("org-abc");

      expect(mockPostKmsRpc).toHaveBeenCalledTimes(2);
      expect(result.wallets).toHaveLength(21);
    });

    it("uses offset=0 for the first page and offset=20 for the second", async () => {
      const fullPage = Array.from({ length: 20 }, (_, i) => ({ walletId: `w-${i}`, tags: [] }));
      mockPostKmsRpc
        .mockResolvedValueOnce({ data: { result: { wallets: fullPage } } })
        .mockResolvedValueOnce({ data: { result: { wallets: [] } } });
      const client = makeClient();

      await client.getOrganizationWallets("org-abc");

      const firstCall = mockPostKmsRpc.mock.calls[0][0] as { params: { offset: number } };
      const secondCall = mockPostKmsRpc.mock.calls[1][0] as { params: { offset: number } };
      expect(firstCall.params.offset).toBe(0);
      expect(secondCall.params.offset).toBe(20);
    });

    it("accumulates wallets across multiple full pages", async () => {
      const page1 = Array.from({ length: 20 }, (_, i) => ({ walletId: `w-${i}`, tags: [] }));
      const page2 = Array.from({ length: 20 }, (_, i) => ({ walletId: `w-${i + 20}`, tags: [] }));
      const page3 = [{ walletId: "w-40", tags: ["my-app"] }];
      mockPostKmsRpc
        .mockResolvedValueOnce({ data: { result: { wallets: page1 } } })
        .mockResolvedValueOnce({ data: { result: { wallets: page2 } } })
        .mockResolvedValueOnce({ data: { result: { wallets: page3 } } });
      const client = makeClient();

      const result = await client.getOrganizationWallets("org-abc");

      expect(mockPostKmsRpc).toHaveBeenCalledTimes(3);
      expect(result.wallets).toHaveLength(41);
      expect(result.wallets[40].walletId).toBe("w-40");
    });

    it("stops after a page with exactly one fewer wallet than the limit", async () => {
      const almostFull = Array.from({ length: 19 }, (_, i) => ({ walletId: `w-${i}`, tags: [] }));
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { wallets: almostFull } } });
      const client = makeClient();

      await client.getOrganizationWallets("org-abc");

      expect(mockPostKmsRpc).toHaveBeenCalledTimes(1);
    });

    it("throws on KMS-level RPC error", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { error: { code: -32001, message: "Forbidden" } } });
      const client = makeClient();

      await expect(client.getOrganizationWallets("org-abc")).rejects.toThrow("KMS RPC error");
    });

    it("throws on KMS-level RPC error during a subsequent page fetch", async () => {
      const fullPage = Array.from({ length: 20 }, (_, i) => ({ walletId: `w-${i}`, tags: [] }));
      mockPostKmsRpc
        .mockResolvedValueOnce({ data: { result: { wallets: fullPage } } })
        .mockResolvedValueOnce({ data: { error: { code: -32001, message: "Forbidden" } } });
      const client = makeClient();

      await expect(client.getOrganizationWallets("org-abc")).rejects.toThrow("KMS RPC error");
    });
  });

  describe("getOrCreateWalletWithTag", () => {
    const walletArgs = {
      organizationId: "org-abc",
      walletName: "App Wallet (my-app)",
      tag: "my-app",
      accounts: [] as never[],
      mnemonicLength: 24,
    };

    it("returns the KmsWalletWithDerivedAccounts result", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({
        data: { result: { walletId: "wallet-new", tags: ["my-app"] } },
      });
      const client = makeClient();

      const result = await client.getOrCreateWalletWithTag(walletArgs);
      expect(result.walletId).toBe("wallet-new");
    });

    it("uses GetOrCreateWalletWithTagMethodEnum.getOrCreateWalletWithTag as the method", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { walletId: "wallet-new" } } });
      const client = makeClient();

      await client.getOrCreateWalletWithTag(walletArgs);

      const request = mockPostKmsRpc.mock.calls[0][0] as { method: string };
      expect(request.method).toBe("getOrCreateWalletWithTag");
    });

    it("passes all args in the RPC params", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { result: { walletId: "wallet-new" } } });
      const client = makeClient();
      const accounts = [{ curve: "Ed25519", derivationPath: "m/44'/501'/0'/0'", addressFormat: "solana" }];

      await client.getOrCreateWalletWithTag({
        organizationId: "org-abc",
        walletName: "App Wallet (my-app)",
        tag: "my-app",
        accounts: accounts as never[],
        mnemonicLength: 24,
      });

      const request = mockPostKmsRpc.mock.calls[0][0] as { params: Record<string, unknown> };
      expect(request.params.organizationId).toBe("org-abc");
      expect(request.params.walletName).toBe("App Wallet (my-app)");
      expect(request.params.tag).toBe("my-app");
      expect(request.params.accounts).toEqual(accounts);
      expect(request.params.mnemonicLength).toBe(24);
    });

    it("throws on KMS-level RPC error", async () => {
      mockPostKmsRpc.mockResolvedValueOnce({ data: { error: { code: -32002, message: "Create failed" } } });
      const client = makeClient();

      await expect(client.getOrCreateWalletWithTag(walletArgs)).rejects.toThrow("KMS RPC error");
    });
  });
});
