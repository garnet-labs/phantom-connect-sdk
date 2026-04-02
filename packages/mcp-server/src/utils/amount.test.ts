import { parseBaseUnitAmount, parseUiAmount, requirePositiveAmount } from "./amount";

describe("amount utils", () => {
  describe("parseBaseUnitAmount", () => {
    it.each([
      [123, 123n],
      ["456", 456n],
    ])("parses %s → %s", (input, expected) => {
      expect(parseBaseUnitAmount(input)).toBe(expected);
    });

    it.each([
      [-1, "safe non-negative integer"],
      [Number.MAX_SAFE_INTEGER + 1, "safe non-negative integer"],
      ["12.5", "non-negative integer"],
    ])("rejects %s", (input, errorMatch) => {
      expect(() => parseBaseUnitAmount(input)).toThrow(errorMatch);
    });
  });

  describe("parseUiAmount", () => {
    it.each([
      ["1.25", 6, 1250000n],
      [2, 9, 2000000000n],
      [1e-7, 9, 100n],
    ])("converts parseUiAmount(%s, %i) → %s", (input, decimals, expected) => {
      expect(parseUiAmount(input, decimals)).toBe(expected);
    });

    it.each([
      ["abc", 6, "non-negative decimal number"],
      ["0.123", 2, "too many decimal places"],
      ["1", -1, "decimals must be a non-negative integer"],
    ])("rejects parseUiAmount(%s, %i)", (input, decimals, errorMatch) => {
      expect(() => parseUiAmount(input, decimals)).toThrow(errorMatch);
    });
  });

  describe("requirePositiveAmount", () => {
    it("allows positive amounts", () => {
      expect(() => requirePositiveAmount(1n)).not.toThrow();
    });

    it.each([
      [0n, "amount must be greater than 0"],
      [-1n, "amount must be greater than 0"],
    ])("rejects %s", (input, errorMatch) => {
      expect(() => requirePositiveAmount(input)).toThrow(errorMatch);
    });
  });
});
