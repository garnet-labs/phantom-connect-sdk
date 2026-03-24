# @phantom/perps-client

Hyperliquid perpetuals trading client for Phantom API. Handles EIP-712 signing and Phantom backend API calls for the full perpetuals lifecycle — from funding deposits through position management.

## Architecture

```
PerpsClient
    ├── Read operations  →  Phantom backend API  →  Hyperliquid data
    └── Write operations →  EIP-712 sign  →  Phantom backend  →  Hyperliquid exchange
```

## Installation

```bash
yarn add @phantom/perps-client
```

## Usage

```typescript
import { PerpsClient } from "@phantom/perps-client";

const client = new PerpsClient({
  evmAddress: "0xYourEvmAddress",
  signTypedData: async typedData => {
    // Sign EIP-712 typed data and return 0x-prefixed hex signature
    return phantomClient.ethereumSignTypedData({
      walletId,
      typedData,
      networkId: "eip155:42161", // Arbitrum — used for all Hyperliquid signing
      derivationIndex: 0,
    });
  },
  apiBaseUrl: "https://api.phantom.app", // optional
});

// Read
const balance = await client.getBalance();
const positions = await client.getPositions();
const orders = await client.getOpenOrders();
const markets = await client.getMarkets();

// Write
await client.openPosition({ market: "BTC", direction: "long", sizeUsd: "100", leverage: 10, orderType: "market" });
await client.closePosition({ market: "BTC" });
await client.cancelOrder({ market: "BTC", orderId: 12345 });
await client.updateLeverage({ market: "BTC", leverage: 5, marginType: "cross" });

// Internal transfers (both accounts on Hypercore)
await client.deposit("100"); // spot → perp
await client.withdraw("50"); // perp → spot
```

## API Reference

### Constructor

```typescript
new PerpsClient(options: PerpsClientOptions)
```

| Option          | Type                                              | Description                                               |
| --------------- | ------------------------------------------------- | --------------------------------------------------------- |
| `evmAddress`    | `string`                                          | The wallet's EVM address (0x-prefixed)                    |
| `signTypedData` | `(typedData: Eip712TypedData) => Promise<string>` | Signs EIP-712 data, returns 0x-prefixed hex signature     |
| `apiBaseUrl`    | `string?`                                         | Phantom API base URL (default: `https://api.phantom.app`) |

### Read Methods

| Method                | Returns              | Endpoint                                      |
| --------------------- | -------------------- | --------------------------------------------- |
| `getBalance()`        | `PerpAccountBalance` | `GET /swap/v2/perp/balance`                   |
| `getPositions()`      | `PerpPosition[]`     | `GET /swap/v2/perp/positions-and-open-orders` |
| `getOpenOrders()`     | `PerpOrder[]`        | `GET /swap/v2/perp/positions-and-open-orders` |
| `getMarkets()`        | `PerpMarket[]`       | `GET /swap/v2/perp/markets`                   |
| `getTradeHistory()`   | `HistoricalOrder[]`  | `GET /swap/v2/perp/trade-history`             |
| `getFundingHistory()` | `FundingActivity[]`  | `GET /swap/v2/perp/deposits-and-withdrawals`  |

### Write Methods

| Method                   | Signs                              | Endpoint                                |
| ------------------------ | ---------------------------------- | --------------------------------------- |
| `openPosition(params)`   | Exchange/Agent EIP-712             | `POST /swap/v2/exchange`                |
| `closePosition(params)`  | Exchange/Agent EIP-712             | `POST /swap/v2/exchange`                |
| `cancelOrder(params)`    | Exchange/Agent EIP-712             | `POST /swap/v2/exchange`                |
| `updateLeverage(params)` | Exchange/Agent EIP-712             | `POST /swap/v2/exchange`                |
| `deposit(amountUsdc)`    | HyperliquidSignTransaction EIP-712 | `POST /swap/v2/transfer-usdc-spot-perp` |
| `withdraw(amountUsdc)`   | HyperliquidSignTransaction EIP-712 | `POST /swap/v2/transfer-usdc-spot-perp` |
