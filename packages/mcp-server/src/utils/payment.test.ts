import { PaymentRequiredError, RateLimitError } from "@phantom/phantom-api-client";
import { wrapWithPaymentHandling } from "./payment";

describe("wrapWithPaymentHandling", () => {
  it("returns successful values unchanged", async () => {
    await expect(wrapWithPaymentHandling(() => Promise.resolve({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it("converts PaymentRequiredError into structured result", async () => {
    const result = await wrapWithPaymentHandling(() => {
      throw new PaymentRequiredError("daily", {
        network: "solana:101",
        token: "CASH",
        amount: "0.1",
        preparedTx: "abc123",
        description: "Daily quota refill",
      });
    });

    expect(result).toEqual(
      expect.objectContaining({
        paymentRequired: true,
        limitType: "daily",
        token: "CASH",
        amount: "0.1",
        preparedTx: "abc123",
      }),
    );
  });

  it("converts RateLimitError into structured result", async () => {
    const result = await wrapWithPaymentHandling(() => {
      throw new RateLimitError(1500);
    });

    expect(result).toEqual(
      expect.objectContaining({
        rateLimited: true,
        retryAfterMs: 1500,
      }),
    );
  });

  it("rethrows unknown errors", async () => {
    await expect(
      wrapWithPaymentHandling(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
