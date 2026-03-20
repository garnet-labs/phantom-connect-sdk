/**
 * Validation helpers for PerpsClient string parameters.
 *
 * Numeric types (number, boolean, enum unions) are sufficiently constrained by
 * TypeScript and validated by callers (e.g. the MCP layer). String parameters,
 * however, carry no format guarantee — any string value satisfies `string` — so
 * the client must enforce canonical format before embedding them in signed payloads.
 */

/**
 * Throws if value is not a canonical positive decimal string (e.g. "100" or "10.5").
 * Rejects leading/trailing whitespace, scientific notation, negative values, and zero.
 */
export function assertPositiveDecimalString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value !== value.trim() || !/^\d+(\.\d+)?$/.test(value) || parseFloat(value) <= 0) {
    throw new Error(`${name} must be a positive number string (e.g. "100" or "10.5")`);
  }
}
