/**
 * MCP Tool types and interfaces
 */

import type { PhantomClient } from "@phantom/client";
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
