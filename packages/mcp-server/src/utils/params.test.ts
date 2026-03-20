import {
  parseChainId,
  parseOptionalNonNegativeInteger,
  assertPositiveDecimalString,
  assertPositiveFiniteNumber,
  assertFiniteNumberAtLeast,
  assertFiniteNumberInRange,
  assertSafeInteger,
} from "./params";

describe("parseChainId", () => {
  it("accepts a number", () => {
    expect(parseChainId(8453)).toBe(8453);
  });

  it("accepts a decimal string", () => {
    expect(parseChainId("8453")).toBe(8453);
    expect(parseChainId("1")).toBe(1);
  });

  it("accepts a hex string", () => {
    expect(parseChainId("0x2105")).toBe(8453);
    expect(parseChainId("0x1")).toBe(1);
  });

  it("throws for missing or invalid values", () => {
    expect(() => parseChainId(undefined)).toThrow("chainId must be a number");
    expect(() => parseChainId(null)).toThrow("chainId must be a number");
    expect(() => parseChainId("notanumber")).toThrow("chainId must be a number");
    expect(() => parseChainId(0)).toThrow("chainId must be a number");
    expect(() => parseChainId(-1)).toThrow("chainId must be a number");
  });
});

describe("parseOptionalNonNegativeInteger", () => {
  it("returns undefined for nullish values", () => {
    expect(parseOptionalNonNegativeInteger(undefined, "derivationIndex")).toBeUndefined();
    expect(parseOptionalNonNegativeInteger(null, "derivationIndex")).toBeUndefined();
  });

  it("accepts numeric values", () => {
    expect(parseOptionalNonNegativeInteger(0, "derivationIndex")).toBe(0);
    expect(parseOptionalNonNegativeInteger(7, "derivationIndex")).toBe(7);
  });

  it("accepts numeric strings", () => {
    expect(parseOptionalNonNegativeInteger("0", "derivationIndex")).toBe(0);
    expect(parseOptionalNonNegativeInteger("42", "derivationIndex")).toBe(42);
    expect(parseOptionalNonNegativeInteger(" 9 ", "derivationIndex")).toBe(9);
  });

  it("rejects non-integer and negative values", () => {
    expect(() => parseOptionalNonNegativeInteger("-1", "derivationIndex")).toThrow(
      "derivationIndex must be a non-negative integer",
    );
    expect(() => parseOptionalNonNegativeInteger(0.5, "derivationIndex")).toThrow(
      "derivationIndex must be a non-negative integer",
    );
    expect(() => parseOptionalNonNegativeInteger("abc", "derivationIndex")).toThrow(
      "derivationIndex must be a non-negative integer",
    );
  });
});

describe("assertPositiveDecimalString", () => {
  it("accepts canonical positive decimal strings", () => {
    expect(() => assertPositiveDecimalString("100", "x")).not.toThrow();
    expect(() => assertPositiveDecimalString("10.5", "x")).not.toThrow();
    expect(() => assertPositiveDecimalString("0.001", "x")).not.toThrow();
  });

  it.each([["0"], ["-50"], ["abc"], ["1e5"], [" 100"], ["100 "], [""], ["  "]])("rejects %j", bad => {
    expect(() => assertPositiveDecimalString(bad, "amount")).toThrow("amount");
  });
});

describe("assertPositiveFiniteNumber", () => {
  it("accepts positive finite numbers", () => {
    expect(() => assertPositiveFiniteNumber(1, "x")).not.toThrow();
    expect(() => assertPositiveFiniteNumber(0.001, "x")).not.toThrow();
  });

  it.each([[0], [-1], [NaN], [Infinity]])("rejects %s", bad => {
    expect(() => assertPositiveFiniteNumber(bad, "val")).toThrow("val must be a positive number");
  });
});

describe("assertFiniteNumberAtLeast", () => {
  it("accepts values >= min", () => {
    expect(() => assertFiniteNumberAtLeast(1, "leverage", 1)).not.toThrow();
    expect(() => assertFiniteNumberAtLeast(10, "leverage", 1)).not.toThrow();
  });

  it.each([[0], [0.9], [-1], [NaN], [Infinity]])("rejects %s when min=1", bad => {
    expect(() => assertFiniteNumberAtLeast(bad, "leverage", 1)).toThrow("leverage must be a finite number >= 1");
  });
});

describe("assertFiniteNumberInRange", () => {
  it("accepts values in [min, max]", () => {
    expect(() => assertFiniteNumberInRange(1, "sizePercent", 1, 100)).not.toThrow();
    expect(() => assertFiniteNumberInRange(50, "sizePercent", 1, 100)).not.toThrow();
    expect(() => assertFiniteNumberInRange(100, "sizePercent", 1, 100)).not.toThrow();
  });

  it.each([[0], [101], [NaN], [Infinity], [-1]])("rejects %s for range [1,100]", bad => {
    expect(() => assertFiniteNumberInRange(bad, "sizePercent", 1, 100)).toThrow(
      "sizePercent must be a number between 1 and 100",
    );
  });
});

describe("assertSafeInteger", () => {
  it("accepts safe integers", () => {
    expect(() => assertSafeInteger(0, "id")).not.toThrow();
    expect(() => assertSafeInteger(42, "id")).not.toThrow();
  });

  it.each([[NaN], [Infinity], [42.5], [Number.MAX_SAFE_INTEGER + 1]])("rejects %s", bad => {
    expect(() => assertSafeInteger(bad, "orderId")).toThrow("orderId must be a safe integer");
  });
});
