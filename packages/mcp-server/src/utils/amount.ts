/**
 * Amount parsing utility functions
 */

/**
 * Parses an amount string or number in base units (atomic units)
 * @param amount - The amount to parse (must be a non-negative integer)
 * @returns The amount as a bigint
 * @throws Error if the amount is not a valid non-negative integer
 */
export function parseBaseUnitAmount(amount: string | number): bigint {
  if (typeof amount === "number") {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(
        `amount must be a safe non-negative integer when provided as a number, got: ${JSON.stringify(amount)}. For base unit amounts larger than ${Number.MAX_SAFE_INTEGER}, pass the value as a string instead.`,
      );
    }
    return BigInt(amount);
  }

  // Validate the string format (must be integer, no decimals)
  if (!/^\d+$/.test(amount)) {
    throw new Error(
      `amount must be a non-negative integer when amountUnit is 'base', got: ${JSON.stringify(amount)} (type: ${typeof amount})`,
    );
  }

  return BigInt(amount);
}

/**
 * Parses an amount string or number in UI units (human-readable units) and converts to base units
 * @param amount - The amount to parse (e.g., "0.5", 0.5, "1000", or 1000)
 * @param decimals - The number of decimal places for the token
 * @returns The amount in base units as a bigint
 * @throws Error if the amount format is invalid or has too many decimal places
 */
export function parseUiAmount(amount: string | number, decimals: number): bigint {
  // Convert number to string, handling exponential notation (e.g., 1e-7 -> "0.0000001")
  let amountStr: string;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) {
      throw new Error(`amount must be a finite number, got: ${amount}`);
    }
    const str = String(amount);
    amountStr = /[eE]/.test(str) ? amount.toFixed(decimals) : str;
  } else {
    amountStr = amount;
  }

  // Validate the string format
  if (!/^\d+(\.\d+)?$/.test(amountStr)) {
    throw new Error(
      `amount must be a non-negative decimal number, got: ${JSON.stringify(amount)} (type: ${typeof amount})`,
    );
  }

  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("decimals must be a non-negative integer");
  }

  const [whole, fraction = ""] = amountStr.split(".");
  if (fraction.length > decimals) {
    throw new Error(`amount has too many decimal places (${fraction.length}) for token decimals (${decimals})`);
  }

  const paddedFraction = fraction.padEnd(decimals, "0");
  const combined = `${whole}${paddedFraction}`.replace(/^0+/, "") || "0";

  return BigInt(combined);
}

/**
 * Validates that an amount is positive (greater than zero)
 * @param amount - The amount to validate
 * @throws Error if the amount is not greater than zero
 */
export function requirePositiveAmount(amount: bigint): void {
  if (amount <= 0n) {
    throw new Error("amount must be greater than 0");
  }
}
