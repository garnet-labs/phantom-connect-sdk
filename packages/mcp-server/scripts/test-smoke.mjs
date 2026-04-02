/**
 * Smoke test for the MCP server binary.
 *
 * Spawns `dist/cli.js` over stdio, performs the MCP handshake (initialize →
 * initialized), verifies that tools/list returns the expected set of tools
 * with valid schemas, and makes a single tools/call to confirm the server
 * can handle a request end-to-end.
 *
 * The server is pointed at localhost-only URLs so no real network traffic is
 * produced; a temporary HOME directory isolates any on-disk state.
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const expectedToolNames = [
  "phantom_login",
  "get_wallet_addresses",
  "get_connection_status",
  "get_token_balances",
  "send_solana_transaction",
  "sign_solana_message",
  "transfer_tokens",
  "buy_token",
  "portfolio_rebalance",
  "send_evm_transaction",
  "sign_evm_personal_message",
  "sign_evm_typed_data",
  "get_perp_markets",
  "get_perp_account",
  "get_perp_positions",
  "get_perp_orders",
  "get_perp_trade_history",
  "open_perp_position",
  "close_perp_position",
  "cancel_perp_order",
  "update_perp_leverage",
  "transfer_spot_to_perps",
  "withdraw_from_perps",
  "deposit_to_hyperliquid",
  "pay_api_access",
];

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertLocalUrl = (value, envName) => {
  const parsed = new URL(value);
  const isLocalHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  assert(isLocalHost, `${envName} must use localhost/127.0.0.1 for smoke tests, got: ${value}`);
};

const encodeMessage = payload => `${JSON.stringify(payload)}\n`;

let requestId = 1;
const makeRequest = (method, params = {}) => ({
  jsonrpc: "2.0",
  id: requestId++,
  method,
  params,
});

const createProtocolClient = child => {
  let buffer = "";
  const pending = new Map();
  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  let exitResolve = null;
  const onExitPromise = new Promise(resolve => {
    exitResolve = resolve;
  });

  const parseFrames = () => {
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      const message = JSON.parse(line);

      if (typeof message.id !== "undefined" && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          reject(new Error(`JSON-RPC ${message.id} failed: ${JSON.stringify(message.error)}`));
        } else {
          resolve(message.result);
        }
      }
    }
  };

  child.stdout.on("data", chunk => {
    buffer += chunk.toString("utf8");
    parseFrames();
  });

  child.on("exit", (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
    const reason = new Error(`phantom-mcp exited unexpectedly with code ${code}`);
    for (const { reject } of pending.values()) {
      reject(reason);
    }
    pending.clear();
    if (exitResolve) {
      exitResolve({ code, signal });
    }
  });

  const send = payload => {
    child.stdin.write(encodeMessage(payload));
  };

  const request = (method, params = {}, timeoutMs = 10000) => {
    const payload = makeRequest(method, params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(payload.id);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, timeoutMs);

      pending.set(payload.id, {
        resolve: result => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      });

      send(payload);
    });
  };

  const notify = (method, params = {}) => {
    send({
      jsonrpc: "2.0",
      method,
      params,
    });
  };

  const waitForExit = async timeoutMs => {
    if (exited) {
      return { code: exitCode, signal: exitSignal };
    }
    return await Promise.race([
      onExitPromise,
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Timeout waiting for phantom-mcp exit after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  };

  return { request, notify, waitForExit };
};

const sessionDir = mkdtempSync(join(tmpdir(), "phantom-mcp-smoke-"));
let child = null;
let stderr = "";
let protocolClient = null;

try {
  const authBaseUrl = process.env.PHANTOM_AUTH_BASE_URL ?? "http://127.0.0.1:1";
  const apiBaseUrl = process.env.PHANTOM_API_BASE_URL ?? "http://127.0.0.1:1";
  assertLocalUrl(authBaseUrl, "PHANTOM_AUTH_BASE_URL");
  assertLocalUrl(apiBaseUrl, "PHANTOM_API_BASE_URL");

  child = spawn("node", ["dist/cli.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PHANTOM_AUTH_BASE_URL: authBaseUrl,
      PHANTOM_API_BASE_URL: apiBaseUrl,
      HOME: sessionDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stderr.on("data", chunk => {
    stderr += chunk.toString("utf8");
  });

  protocolClient = createProtocolClient(child);

  const initializeResult = await protocolClient.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "mcp-smoke-test",
      version: "1.0.0",
    },
  });
  assert(initializeResult && typeof initializeResult === "object", "initialize did not return an object result");
  assert(typeof initializeResult.protocolVersion === "string", "initialize missing protocolVersion");
  assert(
    initializeResult.serverInfo && typeof initializeResult.serverInfo.name === "string",
    "initialize missing serverInfo.name",
  );
  assert(
    initializeResult.capabilities && typeof initializeResult.capabilities === "object",
    "initialize missing capabilities",
  );
  protocolClient.notify("notifications/initialized");

  const listResult = await protocolClient.request("tools/list", {});
  assert(Array.isArray(listResult.tools), "tools/list did not return a tools array");
  assert(listResult.tools.length > 0, "tools/list returned no tools");

  for (const tool of listResult.tools) {
    assert(typeof tool.name === "string" && tool.name.length > 0, "tool entry missing name");
    assert(typeof tool.description === "string", `tool ${tool.name} missing description`);
    assert(tool.inputSchema && typeof tool.inputSchema === "object", `tool ${tool.name} missing inputSchema`);
  }

  const names = listResult.tools.map(tool => tool.name);
  const missing = expectedToolNames.filter(name => !names.includes(name));
  assert(missing.length === 0, `tools/list missing expected tools: ${missing.join(", ")}`);
  assert(names.length >= expectedToolNames.length, "tools/list returned fewer tools than expected");

  const callResult = await protocolClient.request("tools/call", {
    name: "get_connection_status",
    arguments: {},
  });
  assert(Array.isArray(callResult.content), "tools/call did not return content array");
  const parsedCallPayload = JSON.parse(callResult.content[0].text);
  if (typeof parsedCallPayload.connected !== "boolean") {
    assert(typeof parsedCallPayload.error === "string", "get_connection_status returned unexpected payload");
  }

  process.stdout.write(`test:smoke succeeded with ${names.length} tools\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const stderrTail = stderr.split("\n").slice(-20).join("\n");
  throw new Error(`${message}\n\nphantom-mcp stderr (tail):\n${stderrTail}`);
} finally {
  if (child && child.exitCode === null && !child.killed) {
    child.kill("SIGTERM");
    await protocolClient?.waitForExit(5000).catch(() => undefined);
  }
  child?.stdin.end();
  child?.stdout.destroy();
  child?.stderr.destroy();
  if (existsSync(sessionDir)) {
    rmSync(sessionDir, { recursive: true, force: true });
  }
}
