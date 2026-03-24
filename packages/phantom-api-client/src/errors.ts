export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`Rate limit exceeded. Retry after ${retryAfterMs}ms`);
    this.name = "RateLimitError";
  }
}

export class PaymentRequiredError extends Error {
  constructor(
    public limitType: "daily",
    public payment: {
      network: string;
      token: string;
      amount: string;
      preparedTx: string;
      description: string;
    },
  ) {
    super(`Payment required: ${payment.description}`);
    this.name = "PaymentRequiredError";
  }
}
