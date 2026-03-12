import { parseChainId, parseOptionalNonNegativeInteger } from "./params";

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
