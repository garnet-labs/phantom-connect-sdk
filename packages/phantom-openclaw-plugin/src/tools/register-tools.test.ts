import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { OpenClawApi } from "../client/types.js";
import type { PluginSession } from "../session.js";
import { registerPhantomTools } from "./register-tools.js";

type RegisteredTool = Parameters<OpenClawApi["registerTool"]>[0];

function registerToolsForTest(): RegisteredTool[] {
  const registeredTools: RegisteredTool[] = [];
  const api: OpenClawApi = {
    registerTool(definition) {
      registeredTools.push(definition);
    },
  };

  const session = {
    getClient: jest.fn(),
    getSession: jest.fn(),
  } as unknown as PluginSession;

  registerPhantomTools(api, session);
  return registeredTools;
}

function findToolSchema(registeredTools: RegisteredTool[], toolName: string): TSchema {
  const tool = registeredTools.find(candidate => candidate.name === toolName);
  expect(tool).toBeDefined();
  return tool!.parameters as TSchema;
}

describe("registerPhantomTools schema conversion", () => {
  it("preserves buy_token enum, union types, and required fields", () => {
    const registeredTools = registerToolsForTest();
    const buyTokenSchema = findToolSchema(registeredTools, "buy_token");

    expect(Value.Check(buyTokenSchema, { amount: "1", amountUnit: "ui" })).toBe(true);
    expect(Value.Check(buyTokenSchema, { amount: 1, amountUnit: "base" })).toBe(true);

    expect(Value.Check(buyTokenSchema, { amount: "1", amountUnit: "lamports" })).toBe(false);
    expect(Value.Check(buyTokenSchema, { amount: { value: "1" } })).toBe(false);
    expect(Value.Check(buyTokenSchema, {})).toBe(false);
  });

  it("preserves other tool constraints such as required fields and integer validation", () => {
    const registeredTools = registerToolsForTest();
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
});
