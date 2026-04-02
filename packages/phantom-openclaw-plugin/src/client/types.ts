/**
 * OpenClaw Plugin API types
 */

/**
 * OpenClaw Plugin API interface
 */
export type OpenClawApi = {
  /** OpenClaw config payload (can be full openclaw.json, not only plugin-scoped config) */
  config?: Record<string, unknown>;
  /** Optional plugin-load context surfaced by OpenClaw when supported */
  registerContext?: (definition: { id: string; description: string; content: string }) => void;
  /** Register a tool with OpenClaw */
  registerTool: (definition: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (id: string, params: Record<string, unknown>) => Promise<{ content: unknown; isError?: boolean }>;
  }) => void;
};
