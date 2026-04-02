/**
 * Shared utility for calling the Phantom simulation API.
 */

import type { ToolContext } from "../tools/types.js";
import { normalizeSwapperChainId } from "./network.js";

export const DEFAULT_SIMULATION_URL = "https://agents.phantom.app";

export interface SimulationRequestBody {
  type: "transaction" | "message";
  chainId: string;
  params: Record<string, unknown>;
  userAccount?: string;
  url?: string;
  context?: string;
}

/**
 * Calls the Phantom simulation API and returns the parsed response.
 * Normalizes the chainId to the swapper format (e.g. "solana:mainnet" → "solana:101").
 *
 * @throws Error on non-2xx response or network timeout
 */
export function runSimulation(body: SimulationRequestBody, context: ToolContext, language = "en"): Promise<unknown> {
  const { logger, apiClient } = context;

  const normalizedChainId = normalizeSwapperChainId(body.chainId);
  // The simulation API requires url to be a non-empty string; fall back to a stable MCP origin.
  const requestBody = { ...body, chainId: normalizedChainId, url: body.url || DEFAULT_SIMULATION_URL };

  logger.debug(`Running simulation on ${normalizedChainId}`);

  return apiClient.post<unknown>(`/simulation/v1?language=${encodeURIComponent(language)}`, requestBody);
}
