import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PaymentRequiredError, RateLimitError } from "@phantom/phantom-api-client";

const mockTools = [
  {
    name: "phantom_login",
    description: "login",
    inputSchema: { type: "object", properties: {} },
    annotations: { openWorldHint: true, idempotentHint: false },
    handler: jest.fn(),
  },
  {
    name: "mock_tool",
    description: "tool",
    inputSchema: { type: "object", properties: { amount: { type: "number" } } },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: jest.fn(),
  },
];
const mockGetTool = jest.fn();

const mockHandlers = new Map();
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockSetRequestHandler = jest.fn((schema, handler) => {
  mockHandlers.set(schema, handler);
});

const mockSessionManagerInstance = {
  initialize: jest.fn().mockResolvedValue(undefined),
  resetSession: jest.fn().mockResolvedValue(undefined),
  tryRefreshSession: jest.fn().mockResolvedValue(false),
  getClient: jest.fn(),
  getSession: jest.fn(),
  getOAuthHeaders: jest.fn().mockReturnValue({}),
};

const mockSetHeaders = jest.fn();
const mockSetGetHeaders = jest.fn();
const mockSetPaymentHandler = jest.fn();

jest.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: mockSetRequestHandler,
    connect: mockConnect,
  })),
}));

jest.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("./session/manager", () => ({
  SessionManager: jest.fn().mockImplementation(() => mockSessionManagerInstance),
}));

jest.mock("./tools/index", () => ({
  tools: mockTools,
  getTool: mockGetTool,
}));

jest.mock("@phantom/phantom-api-client", () => {
  const actual = jest.requireActual("@phantom/phantom-api-client");
  return {
    ...actual,
    PhantomApiClient: jest.fn().mockImplementation(() => ({
      setHeaders: mockSetHeaders,
      setGetHeaders: mockSetGetHeaders,
      setPaymentHandler: mockSetPaymentHandler,
    })),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PhantomMCPServer } = require("./server");

beforeEach(() => {
  jest.spyOn(process.stderr, "write").mockImplementation(() => true);
  mockHandlers.clear();
  mockConnect.mockClear();
  mockSetRequestHandler.mockClear();
  mockSetHeaders.mockClear();
  mockSetGetHeaders.mockClear();
  mockSetPaymentHandler.mockClear();
  mockGetTool.mockReset();
  for (const tool of mockTools) {
    tool.handler.mockReset();
  }
  mockSessionManagerInstance.initialize.mockReset().mockResolvedValue(undefined);
  mockSessionManagerInstance.resetSession.mockReset().mockResolvedValue(undefined);
  mockSessionManagerInstance.tryRefreshSession.mockReset().mockResolvedValue(false);
  mockSessionManagerInstance.getClient.mockReset();
  mockSessionManagerInstance.getSession.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const getHandlers = () => ({
  listTools: mockHandlers.get(ListToolsRequestSchema),
  callTool: mockHandlers.get(CallToolRequestSchema),
});

describe("PhantomMCPServer", () => {
  it("returns registered tools via tools/list", () => {
    new PhantomMCPServer();
    const { listTools } = getHandlers();
    const result = listTools();
    expect(result.tools).toHaveLength(mockTools.length);
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(["phantom_login", "mock_tool"]);
    expect(result.tools[0]).toEqual({
      name: "phantom_login",
      description: "login",
      inputSchema: { type: "object", properties: {} },
      annotations: { openWorldHint: true, idempotentHint: false },
    });
    expect(result.tools[1]).toEqual({
      name: "mock_tool",
      description: "tool",
      inputSchema: { type: "object", properties: { amount: { type: "number" } } },
      annotations: { readOnlyHint: true, openWorldHint: false },
    });
  });

  it("dispatches tools/call and returns JSON result", async () => {
    const toolHandler = jest.fn().mockResolvedValue({ ok: true, value: 123 });
    mockGetTool.mockReturnValue({
      name: "mock_tool",
      description: "tool",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      handler: toolHandler,
    });
    mockSessionManagerInstance.getClient.mockReturnValue({ client: true });
    mockSessionManagerInstance.getSession.mockReturnValue({ walletId: "wallet-1", organizationId: "org-1" });

    new PhantomMCPServer();
    const { callTool } = getHandlers();
    const result = await callTool({ params: { name: "mock_tool", arguments: { amount: 1 } } });

    expect(toolHandler).toHaveBeenCalledWith(
      { amount: 1 },
      expect.objectContaining({
        client: { client: true },
        session: { walletId: "wallet-1", organizationId: "org-1" },
      }),
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true, value: 123 });
  });

  it("returns an error for unknown tools", async () => {
    mockGetTool.mockReturnValue(undefined);

    new PhantomMCPServer();
    const { callTool } = getHandlers();
    const result = await callTool({ params: { name: "missing_tool", arguments: {} } });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({ error: "Unknown tool: missing_tool" });
    expect(mockSessionManagerInstance.getClient).not.toHaveBeenCalled();
    expect(mockSessionManagerInstance.getSession).not.toHaveBeenCalled();
  });

  it("handles phantom_login by resetting session and returning auth details", async () => {
    mockGetTool.mockReturnValue(mockTools[0]);
    mockSessionManagerInstance.getSession.mockReturnValue({
      walletId: "wallet-login",
      organizationId: "org-1",
      appId: "session-client-id",
      authFlow: "sso",
    });
    mockSessionManagerInstance.getClient.mockReturnValue({
      getWalletAddresses: jest.fn().mockResolvedValue([{ addressType: "solana", address: "So1Address" }]),
    });

    new PhantomMCPServer();
    const { callTool } = getHandlers();
    const result = await callTool({ params: { name: "phantom_login", arguments: {} } });

    expect(mockSessionManagerInstance.resetSession).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.content[0].text)).toEqual(
      expect.objectContaining({ success: true, walletId: "wallet-login", authFlow: "sso" }),
    );
    expect(mockSetHeaders).toHaveBeenCalledWith(
      expect.objectContaining({
        "x-api-key": "session-client-id",
        "X-App-Id": "session-client-id",
      }),
    );
    expect(mockSetPaymentHandler).toHaveBeenCalledTimes(1);
  });

  it("passes text display mode to phantom_login and returns the prompt text", async () => {
    mockGetTool.mockReturnValue(mockTools[0]);
    mockSessionManagerInstance.resetSession.mockImplementation((_opts?: unknown) => Promise.resolve(undefined));
    mockSessionManagerInstance.getSession.mockReturnValue({
      walletId: "wallet-login",
      organizationId: "org-1",
      appId: "session-client-id",
      authFlow: "device-code",
    });
    mockSessionManagerInstance.getClient.mockReturnValue({
      getWalletAddresses: jest.fn().mockResolvedValue([{ addressType: "solana", address: "So1Address" }]),
    });

    new PhantomMCPServer();
    const { callTool } = getHandlers();
    const result = await callTool({ params: { name: "phantom_login", arguments: { displayMode: "text" } } });

    expect(mockSessionManagerInstance.resetSession).toHaveBeenCalledWith(
      expect.objectContaining({
        openBrowser: false,
        onPrompt: expect.any(Function),
      }),
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.authFlow).toBe("device-code");
  });

  it("returns AUTH_EXPIRED and resets session when token refresh fails on 401", async () => {
    const toolHandler = jest.fn().mockRejectedValue({ response: { status: 401 } });
    mockGetTool.mockReturnValue({
      name: "mock_tool",
      description: "tool",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      handler: toolHandler,
    });
    mockSessionManagerInstance.getClient.mockReturnValue({ client: true });
    mockSessionManagerInstance.getSession.mockReturnValue({ walletId: "wallet-1", organizationId: "org-1" });
    mockSessionManagerInstance.tryRefreshSession.mockResolvedValue(false);

    new PhantomMCPServer();
    const { callTool } = getHandlers();
    const result = await callTool({ params: { name: "mock_tool", arguments: {} } });
    const parsed = JSON.parse(result.content[0].text);

    expect(mockSessionManagerInstance.tryRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockSessionManagerInstance.resetSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error:
                "Session expired. Re-authentication was triggered — please complete the Phantom Connect browser sign-in and retry this request.",
              code: "AUTH_EXPIRED",
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    });
    expect(parsed.code).toBe("AUTH_EXPIRED");
  });

  it("retries the tool after a successful token refresh and returns the result", async () => {
    const retryResult = { success: true, data: "retried" };
    const toolHandler = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce(retryResult);
    mockGetTool.mockReturnValue({
      name: "mock_tool",
      description: "tool",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      handler: toolHandler,
    });
    mockSessionManagerInstance.getClient.mockReturnValue({ client: true });
    mockSessionManagerInstance.getSession.mockReturnValue({ walletId: "wallet-1", organizationId: "org-1" });
    mockSessionManagerInstance.tryRefreshSession.mockResolvedValue(true);

    new PhantomMCPServer();
    const { callTool } = getHandlers();
    const result = await callTool({ params: { name: "mock_tool", arguments: {} } });

    expect(mockSessionManagerInstance.tryRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockSessionManagerInstance.resetSession).not.toHaveBeenCalled();
    expect(toolHandler).toHaveBeenCalledTimes(2);
    expect(JSON.parse(result.content[0].text)).toEqual(retryResult);
  });

  it("resets session when the retry also returns 401 after a successful token refresh", async () => {
    const toolHandler = jest.fn().mockRejectedValue({ response: { status: 401 } });
    mockGetTool.mockReturnValue({
      name: "mock_tool",
      description: "tool",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      handler: toolHandler,
    });
    mockSessionManagerInstance.getClient.mockReturnValue({ client: true });
    mockSessionManagerInstance.getSession.mockReturnValue({ walletId: "wallet-1", organizationId: "org-1" });
    mockSessionManagerInstance.tryRefreshSession.mockResolvedValue(true);

    new PhantomMCPServer();
    const { callTool } = getHandlers();
    const result = await callTool({ params: { name: "mock_tool", arguments: {} } });
    const parsed = JSON.parse(result.content[0].text);

    expect(mockSessionManagerInstance.tryRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockSessionManagerInstance.resetSession).toHaveBeenCalledTimes(1);
    expect(toolHandler).toHaveBeenCalledTimes(2);
    expect(parsed.code).toBe("AUTH_EXPIRED");
  });

  it("returns AUTH_EXPIRED and resets session on 403 errors when refresh fails", async () => {
    const toolHandler = jest.fn().mockRejectedValue({ response: { status: 403 } });
    mockGetTool.mockReturnValue({
      name: "mock_tool",
      description: "tool",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      handler: toolHandler,
    });
    mockSessionManagerInstance.getClient.mockReturnValue({ client: true });
    mockSessionManagerInstance.getSession.mockReturnValue({ walletId: "wallet-1", organizationId: "org-1" });
    mockSessionManagerInstance.tryRefreshSession.mockResolvedValue(false);

    new PhantomMCPServer();
    const { callTool } = getHandlers();
    const result = await callTool({ params: { name: "mock_tool", arguments: {} } });
    const parsed = JSON.parse(result.content[0].text);

    expect(mockSessionManagerInstance.tryRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockSessionManagerInstance.resetSession).toHaveBeenCalledTimes(1);
    expect(parsed.code).toBe("AUTH_EXPIRED");
  });

  it("returns structured API_PAYMENT_REQUIRED payload", async () => {
    const paymentError = new PaymentRequiredError("daily", {
      amount: "0.1",
      token: "CASH",
      network: "solana:101",
      preparedTx: "abc123",
      description: "Pay to continue",
    });
    mockGetTool.mockReturnValue({
      name: "mock_tool",
      description: "tool",
      inputSchema: { type: "object", properties: {} },
      handler: jest.fn().mockRejectedValue(paymentError),
    });
    mockSessionManagerInstance.getClient.mockReturnValue({ client: true });
    mockSessionManagerInstance.getSession.mockReturnValue({ walletId: "wallet-1", organizationId: "org-1" });

    new PhantomMCPServer();
    const { callTool } = getHandlers();
    const result = await callTool({ params: { name: "mock_tool", arguments: {} } });
    const parsed = JSON.parse(result.content[0].text);

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "API_PAYMENT_REQUIRED",
              message:
                "Daily API limit reached. Call pay_api_access with the preparedTx below to pay 0.1 CASH and unlock access, then retry mock_tool.",
              preparedTx: "abc123",
              payment: {
                amount: "0.1",
                token: "CASH",
                network: "solana:101",
                description: "Pay to continue",
              },
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    });
    expect(parsed.error).toBe("API_PAYMENT_REQUIRED");
  });

  it("returns structured RATE_LIMITED payload", async () => {
    mockGetTool.mockReturnValue({
      name: "mock_tool",
      description: "tool",
      inputSchema: { type: "object", properties: {} },
      handler: jest.fn().mockRejectedValue(new RateLimitError(2500)),
    });
    mockSessionManagerInstance.getClient.mockReturnValue({ client: true });
    mockSessionManagerInstance.getSession.mockReturnValue({ walletId: "wallet-1", organizationId: "org-1" });

    new PhantomMCPServer();
    const { callTool } = getHandlers();
    const result = await callTool({ params: { name: "mock_tool", arguments: {} } });
    const parsed = JSON.parse(result.content[0].text);

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "RATE_LIMITED",
              message: "Too many requests. Wait 3 seconds before retrying.",
              retryAfterMs: 2500,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    });
    expect(parsed.error).toBe("RATE_LIMITED");
  });

  it("awaits initPromise before executing tool handlers", async () => {
    let resolveInit: () => void = () => undefined;
    const pendingInit = new Promise<void>(resolve => {
      resolveInit = resolve;
    });
    const toolHandler = jest.fn().mockResolvedValue({ ok: true });

    mockGetTool.mockReturnValue({
      name: "mock_tool",
      description: "tool",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      handler: toolHandler,
    });
    mockSessionManagerInstance.getClient.mockReturnValue({ client: true });
    mockSessionManagerInstance.getSession.mockReturnValue({ walletId: "wallet-1", organizationId: "org-1" });

    const server = new PhantomMCPServer();
    (server as unknown as { initPromise: Promise<void> | null }).initPromise = pendingInit;

    const { callTool } = getHandlers();
    const callPromise = callTool({ params: { name: "mock_tool", arguments: {} } });
    await Promise.resolve();
    expect(toolHandler).not.toHaveBeenCalled();

    resolveInit();
    await callPromise;
    expect(toolHandler).toHaveBeenCalledTimes(1);
  });

  it("does not retry mutating tools after a successful token refresh and asks the caller to retry", async () => {
    const toolHandler = jest.fn().mockRejectedValue({ response: { status: 401 } });
    mockGetTool.mockReturnValue({
      name: "mock_tool",
      description: "tool",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
      handler: toolHandler,
    });
    mockSessionManagerInstance.getClient.mockReturnValue({ client: true });
    mockSessionManagerInstance.getSession.mockReturnValue({ walletId: "wallet-1", organizationId: "org-1" });
    mockSessionManagerInstance.tryRefreshSession.mockResolvedValue(true);

    new PhantomMCPServer();
    const { callTool } = getHandlers();
    const result = await callTool({ params: { name: "mock_tool", arguments: {} } });
    const parsed = JSON.parse(result.content[0].text);

    expect(mockSessionManagerInstance.tryRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockSessionManagerInstance.resetSession).not.toHaveBeenCalled();
    expect(toolHandler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error:
                "Session token was refreshed successfully. Retry the same request now; re-authentication is not required.",
              code: "SESSION_REFRESHED_RETRY_REQUIRED",
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    });
    expect(parsed.code).toBe("SESSION_REFRESHED_RETRY_REQUIRED");
  });
});
