/**
 * MCP Tool types and interfaces
 */

import type { PhantomClient } from "@phantom/client";
import type { PhantomApiClient } from "@phantom/phantom-api-client";
import type { SessionData } from "../session/types.js";
import type { Logger } from "../utils/logger.js";

/**
 * Context provided to tool handlers
 */
export interface ToolContext {
  /** Authenticated PhantomClient instance */
  client: PhantomClient;
  /** Current session data */
  session: SessionData;
  /** Logger instance for this tool */
  logger: Logger;
  /** Shared HTTP client for api.phantom.app (or proxy). Handles 402/429 automatically. */
  apiClient: PhantomApiClient;
}

/**
 * JSON Schema for MCP tool input validation
 */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * MCP Tool annotations describing safety and behavior characteristics.
 * See: https://modelcontextprotocol.io/docs/concepts/tools#tool-annotations
 */
export interface ToolAnnotations {
  /** If true, the tool only reads data and has no side effects */
  readOnlyHint?: boolean;
  /** If true, the tool may perform destructive or irreversible actions (e.g. sending transactions) */
  destructiveHint?: boolean;
  /** If true, calling the tool repeatedly with the same inputs has the same effect as calling it once */
  idempotentHint?: boolean;
  /** If true, the tool may interact with external systems outside the local environment */
  openWorldHint?: boolean;
}

/**
 * MCP Tool definition
 */
export interface ToolHandler {
  /** Tool name (used in tool calls) */
  name: string;
  /** Tool description (shown to LLM) */
  description: string;
  /** JSON schema for input validation */
  inputSchema: ToolInputSchema;
  /** Safety and behavior annotations */
  annotations?: ToolAnnotations;
  /** Tool handler function */
  handler: (params: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

/**
 * Creates a ToolHandler with a typed params interface.
 *
 * The MCP framework validates params against inputSchema before calling the handler,
 * so required fields and their declared types are guaranteed at runtime. Using this
 * helper removes the need for `typeof` guards and `as` casts inside the handler body.
 *
 * The returned object satisfies the untyped `ToolHandler` interface expected by the
 * tool registry, so no changes are needed in index.ts.
 *
 * @example
 * interface Params { market: string; orderId: number; walletId?: string }
 * export const myTool = createTool<Params>({ ..., handler: async (params, ctx) => {
 *   // params.market is string, params.orderId is number — no casts needed
 * }})
 */
export function createTool<P extends object>(definition: {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations?: ToolAnnotations;
  handler: (params: P, context: ToolContext) => Promise<unknown>;
}): ToolHandler {
  return definition as unknown as ToolHandler;
}
