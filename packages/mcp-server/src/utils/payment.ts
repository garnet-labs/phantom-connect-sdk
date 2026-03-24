import { PaymentRequiredError, RateLimitError } from "@phantom/phantom-api-client";

export interface PaymentRequiredResult {
  paymentRequired: true;
  limitType: "daily";
  amount: string;
  token: string;
  preparedTx: string;
  message: string;
}

export interface RateLimitedResult {
  rateLimited: true;
  retryAfterMs: number;
  message: string;
}

/**
 * Wraps an async handler and converts PaymentRequiredError / RateLimitError into
 * structured return values instead of thrown errors. All other errors propagate normally.
 */
export async function wrapWithPaymentHandling<T>(
  fn: () => Promise<T>,
): Promise<T | PaymentRequiredResult | RateLimitedResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PaymentRequiredError) {
      return {
        paymentRequired: true,
        limitType: err.limitType,
        amount: err.payment.amount,
        token: err.payment.token,
        preparedTx: err.payment.preparedTx,
        message: `API quota limit reached. Call pay_api_access with the preparedTx to pay ${err.payment.amount} ${err.payment.token} and unlock access.`,
      };
    }
    if (err instanceof RateLimitError) {
      return {
        rateLimited: true,
        retryAfterMs: err.retryAfterMs,
        message: `Too many requests. Retry in ${err.retryAfterMs}ms.`,
      };
    }
    throw err;
  }
}
