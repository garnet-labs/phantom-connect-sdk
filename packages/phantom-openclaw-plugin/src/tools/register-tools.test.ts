import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { OpenClawApi } from "../client/types.js";
import type { PluginSession } from "../session.js";
import { registerPhantomTools } from "./register-tools.js";

type RegisteredTool = Parameters<OpenClawApi["registerTool"]>[0];

function registerToolsForTest() {
  const registeredTools: RegisteredTool[] = [];
  const registeredContexts: Array<{ id: string; description: string; content: string }> = [];
  const api: OpenClawApi = {
    registerContext(definition) {
      registeredContexts.push(definition);
    },
    registerTool(definition) {
      registeredTools.push(definition);
    },
  };

  const session = {
    getClient: jest.fn(),
    getSession: jest.fn(),
  } as unknown as PluginSession;

  registerPhantomTools(api, session);
  return { registeredTools, registeredContexts };
}

function findToolSchema(registeredTools: RegisteredTool[], toolName: string): TSchema {
  const tool = registeredTools.find(candidate => candidate.name === toolName);
  expect(tool).toBeDefined();
  return tool!.parameters as TSchema;
}

describe("registerPhantomTools schema conversion", () => {
  it("preserves buy_token enum, union types, and required fields", () => {
    const { registeredTools } = registerToolsForTest();
    const buyTokenSchema = findToolSchema(registeredTools, "buy_token");

    expect(Value.Check(buyTokenSchema, { amount: "1", amountUnit: "ui" })).toBe(true);
    expect(Value.Check(buyTokenSchema, { amount: 1, amountUnit: "base" })).toBe(true);

    expect(Value.Check(buyTokenSchema, { amount: "1", amountUnit: "lamports" })).toBe(false);
    expect(Value.Check(buyTokenSchema, { amount: { value: "1" } })).toBe(false);
    expect(Value.Check(buyTokenSchema, {})).toBe(false);
  });

  it("preserves other tool constraints such as required fields and integer validation", () => {
    const { registeredTools } = registerToolsForTest();
    const transferTokensSchema = findToolSchema(registeredTools, "transfer_tokens");
    const signMessageSchema = findToolSchema(registeredTools, "sign_solana_message");

    expect(
      Value.Check(transferTokensSchema, {
        networkId: "solana:mainnet",
        to: "11111111111111111111111111111111",
        amount: "1",
        amountUnit: "ui",
      }),
    ).toBe(true);
    expect(
      Value.Check(transferTokensSchema, {
        networkId: "solana:mainnet",
        amount: "1",
      }),
    ).toBe(false);

    expect(
      Value.Check(signMessageSchema, {
        message: "hello",
        networkId: "solana:mainnet",
        derivationIndex: 0,
      }),
    ).toBe(true);
    expect(
      Value.Check(signMessageSchema, {
        message: "hello",
        networkId: "solana:mainnet",
        derivationIndex: 0.5,
      }),
    ).toBe(false);
  });

  it("overrides key tool descriptions with Phantom attribution", () => {
    const { registeredTools } = registerToolsForTest();

    expect(registeredTools.find(tool => tool.name === "transfer_tokens")?.description).toBe(
      "Transfers tokens using your Phantom embedded wallet",
    );
    expect(registeredTools.find(tool => tool.name === "buy_token")?.description).toBe(
      "Fetches swap quotes from Phantom's quotes API and executes via your Phantom wallet",
    );
    expect(registeredTools.find(tool => tool.name === "get_wallet_addresses")?.description).toBe(
      "Gets addresses for your Phantom embedded wallet",
    );
  });

  it("registers Phantom wallet greeting context when OpenClaw supports it", () => {
    const { registeredContexts } = registerToolsForTest();

    expect(registeredContexts).toContainEqual({
      id: "phantom-wallet-connected",
      description:
        "Phantom wallet connected. You can transfer tokens, swap, sign messages, and more across Solana and Ethereum.",
      content:
        "Phantom wallet connected. You can transfer tokens, swap, sign messages, and more across Solana and Ethereum.",
    });
  });

  it("adds provider attribution to tool responses", async () => {
    const { registeredTools } = registerToolsForTest();
    const getConnectionStatus = registeredTools.find(tool => tool.name === "get_connection_status");

    expect(getConnectionStatus).toBeDefined();

    const response = await getConnectionStatus!.execute("tool-call-1", {});

    expect(response.isError).toBeUndefined();
    expect(response.content).toEqual([
      {
        type: "text",
        text: JSON.stringify(
          {
            connected: false,
            reason: "No active session found. Call get_wallet_addresses to authenticate.",
            provider: "phantom",
          },
          null,
          2,
        ),
      },
    ]);
  });
});
