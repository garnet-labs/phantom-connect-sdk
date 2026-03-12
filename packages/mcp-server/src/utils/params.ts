/**
 * Generic parameter parsing helpers for MCP tools.
 */

/**
 * Parse a chain ID from unknown input.
 *
 * Accepts numbers directly, decimal strings ("8453"), and hex strings ("0x2105").
 * Throws if the value is missing, not a valid positive integer, or an unrecognised type.
 */
export function parseChainId(value: unknown): number {
  let parsed: number;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    parsed = value.startsWith("0x") ? parseInt(value, 16) : parseInt(value, 10);
  } else {
    throw new Error("chainId must be a number (e.g. 1 for Ethereum mainnet, 8453 for Base)");
  }

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("chainId must be a number (e.g. 1 for Ethereum mainnet, 8453 for Base)");
  }

  return parsed;
}

/**
 * Parse an optional non-negative integer from unknown input.
 *
 * Accepts numbers directly and numeric strings such as "0".
 * Returns undefined for null/undefined.
 */
export function parseOptionalNonNegativeInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`${fieldName} must be a non-negative integer`);
    }
    parsed = Number(trimmed);
  } else {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return parsed;
}
