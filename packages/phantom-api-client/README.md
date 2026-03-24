# @phantom/phantom-api-client

Shared HTTP client for `api.phantom.app` with automatic 402 payment gating and 429 rate-limit handling.

## Installation

```bash
yarn add @phantom/phantom-api-client
```

## Usage

### Basic setup

```ts
import { PhantomApiClient } from "@phantom/phantom-api-client";

const client = new PhantomApiClient({
  baseUrl: "https://api.phantom.app",
});
```

### Setting static headers

Call `setHeaders()` once after authentication to attach headers to every subsequent request. Typical use: app ID and wallet address.

```ts
client.setHeaders({
  "x-api-key": appId,
  "X-App-Id": appId,
  "X-Wallet-Address": solanaAddress,
});
```

Headers set via `setHeaders()` are merged — calling it again adds or overrides individual keys without clearing the rest.

### Making requests

```ts
// GET with optional query params
const data = await client.get<MyResponse>("/swap/v2/quotes", {
  params: { inputMint: "So11....", outputMint: "EPjF..." },
});

// POST
const result = await client.post<MyResponse>("/swap/v2/quotes", {
  sellToken: "SOL",
  buyToken: "USDC",
  sellAmount: "1000000000",
});
```

### 402 Payment Required

When the API returns a 402, a `PaymentRequiredError` is thrown. You can handle it manually or wire in an automatic payment handler that signs and submits the payment transaction, after which the original request is retried automatically.

```ts
import { PaymentRequiredError } from "@phantom/phantom-api-client";

// Option A — manual catch
try {
  const data = await client.get("/swap/v2/quotes");
} catch (err) {
  if (err instanceof PaymentRequiredError) {
    console.log(err.payment); // { network, token, amount, preparedTx, description }
  }
}

// Option B — automatic handler (wired once after login)
client.setPaymentHandler(async payment => {
  // Sign and broadcast the prepared transaction, return the signature
  const signature = await wallet.signAndSend(payment.preparedTx);
  return signature;
});

// Requests now auto-pay on 402 and retry transparently
const data = await client.get("/swap/v2/quotes");
```

The payment signature is stored automatically via `setPaymentSignature()` and sent as the `X-Payment` header on all subsequent requests.

### 429 Rate Limiting

A 429 response throws `RateLimitError` with a `retryAfterMs` field:

```ts
import { RateLimitError } from "@phantom/phantom-api-client";

try {
  const data = await client.get("/swap/v2/quotes");
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(`Retry after ${err.retryAfterMs}ms`);
  }
}
```

## API

### `new PhantomApiClient(options)`

| Option              | Type             | Description                                                              |
| ------------------- | ---------------- | ------------------------------------------------------------------------ |
| `baseUrl`           | `string`         | Base URL for all requests                                                |
| `logger`            | `Logger`         | Optional logger (`debug`, `info`, `warn`, `error`)                       |
| `onPaymentRequired` | `PaymentHandler` | Optional payment handler (can also be set later via `setPaymentHandler`) |

### Methods

| Method                          | Description                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `get<T>(path, options?)`        | GET request. `options.params` appended as query string. `options.headers` merged for this call only. |
| `post<T>(path, body, options?)` | POST request with JSON body.                                                                         |
| `rpc<T>(path, method, params)`  | JSON-RPC 2.0 wrapper around `post`. Unwraps `result` or throws on `error`.                           |
| `setHeaders(headers)`           | Merges headers into every future request (e.g. `X-Wallet-Address`, `x-api-key`).                     |
| `setPaymentHandler(handler)`    | Wires a payment handler for automatic 402 handling.                                                  |
| `setPaymentSignature(sig)`      | Stores a payment signature sent as `X-Payment` on all subsequent requests.                           |
