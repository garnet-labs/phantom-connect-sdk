# @phantom/perps-client

Hyperliquid perpetuals trading client for Phantom Wallet. Handles EIP-712 signing and Phantom backend API calls for the full perpetuals lifecycle — from funding deposits through position management.

## Architecture

```
PerpsClient
    ├── Read operations  →  Phantom backend API  →  Hyperliquid data
    └── Write operations →  EIP-712 sign  →  Phantom backend  →  Hyperliquid exchange
```

The client is intentionally decoupled from `PhantomClient`. It receives a plain EVM address and a `signTypedData` callback, making it testable with any signer and reusable outside the MCP server.

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

// Deposit flow helpers (used by the MCP deposit_to_hyperliquid tool)
const funding = await client.getFundingAddress("solana:101");
// ... user sends tokens to funding.depositAddress on the source chain ...
const destinationAmount = await client.pollBridgeDeposit(txHash, funding.depositAddress, Date.now());
const usdcAmount = await client.sellSpotToUsdc(funding.spotAssetId, destinationAmount, funding.spotSzDecimals);
await client.deposit(usdcAmount);
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

### Deposit Flow Helpers

| Method                                                             | Description                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| `getFundingAddress(sourceNetworkId)`                               | Gets the deposit address on the source chain         |
| `pollBridgeDeposit(txHash, depositAddress, startedAt, timeoutMs?)` | Polls until bridge confirms (default 10 min timeout) |
| `sellSpotToUsdc(assetId, amount, szDecimals)`                      | Sells bridged token on Hyperliquid spot for USDC     |

## EIP-712 Signing

Hyperliquid uses two EIP-712 signing patterns:

**Exchange actions** (orders, cancel, leverage): The action is msgpack-encoded and keccak256-hashed to produce a `connectionId`. The typed data has `primaryType: "Agent"` with `domain.chainId: 1337` ("off-chain").

**Transfer actions** (deposit/withdraw): Direct EIP-712 with `primaryType: "HyperliquidTransaction:UsdClassTransfer"` and `domain.chainId: 42161` (Arbitrum mainnet).

In both cases, the signed message is sent to the Phantom backend which proxies it to Hyperliquid.

## User Address Format

The Phantom perps API identifies users by their EVM address in CAIP-19 format:

```
hypercore:mainnet/address:0xyourevmaddress
```

This is derived from `evmAddress` automatically.

## Deposit Flow

Bridging funds from an external chain to Hyperliquid perps requires five steps:

```
Source chain (Solana/EVM)
        ↓  POST /swap/v2/spot/funding
        ↓  → deposit address on source chain
        ↓
Send tokens to deposit address
        ↓
Hyperunit/Relay bridge completes
        ↓  GET /swap/v2/spot/bridge-operations (polled every 2s)
        ↓
[If non-USDC] Sell on Hyperliquid spot  →  USDC
        ↓
POST /swap/v2/transfer-usdc-spot-perp (spot → perp)
```

The `deposit_to_hyperliquid` MCP tool orchestrates this entire flow.
