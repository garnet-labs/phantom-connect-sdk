# Perps Tools — Phantom MCP Server

This document covers the 12 perpetuals trading tools added to the Phantom MCP server. They enable AI agents to interact with Hyperliquid perpetuals via Phantom's backend.

## Overview

Hyperliquid is a Phantom-integrated perps exchange built on its own chain (Hypercore). All signing uses Arbitrum EIP-712 (chain ID 42161). The Phantom backend (`api.phantom.app/swap/v2/perp/*`) proxies requests to Hyperliquid.

### Account model

Each wallet has two sub-accounts on Hypercore:

- **Spot account** — receives deposits from bridges, holds tokens
- **Perp account** — USDC collateral used for perpetual positions

Funds flow: External chain → Spot account → Perp account.

---

## Tools

### Read-only

#### `get_perp_markets`

Returns all available perpetual markets with current prices, funding rates, open interest, 24h volume, and max leverage.

```json
{ "walletId": "optional" }
```

#### `get_perp_account`

Returns perp account balance: `accountValue`, `availableBalance`, `availableToTrade`.

```json
{ "walletId": "optional", "derivationIndex": 0 }
```

#### `get_perp_positions`

Returns all open positions with direction, size, entry price, leverage, unrealized PnL, and liquidation price.

```json
{ "walletId": "optional", "derivationIndex": 0 }
```

#### `get_perp_orders`

Returns all open orders (limit, take-profit, stop-loss) with ID, type, price, size, and reduce-only flag.

```json
{ "walletId": "optional", "derivationIndex": 0 }
```

#### `get_perp_trade_history`

Returns historical trades with price, size, trade value, fee, and closed PnL.

```json
{ "walletId": "optional", "derivationIndex": 0 }
```

---

### Write

#### `deposit_to_hyperliquid` ⭐ Full deposit flow

Bridges tokens from an external chain into the Hyperliquid perps account in one call.

**This is the entry point for funding a perps account.** Handles the full flow:

1. Gets deposit address from Phantom backend
2. Builds and sends source-chain transfer (Solana SOL or EVM USDC)
3. Polls bridge operations until confirmed (~1-5 min)
4. Sells bridged token to USDC on Hyperliquid spot (if needed)
5. Transfers USDC from spot → perp

```json
{
  "sourceChainId": "eip155:42161",
  "amount": "100",
  "tokenAddress": "optional — ERC-20/SPL; omit for native SOL or default USDC",
  "walletId": "optional",
  "derivationIndex": 0
}
```

Supported source chains and default tokens:

| `sourceChainId`           | Default token       |
| ------------------------- | ------------------- |
| `solana:mainnet`          | Native SOL          |
| `eip155:42161` (Arbitrum) | USDC (`0xaf88d...`) |
| `eip155:8453` (Base)      | USDC (`0x83358...`) |
| `eip155:1` (Ethereum)     | USDC (`0xa0b86...`) |
| `eip155:137` (Polygon)    | USDC (`0x3c499...`) |

Returns:

```json
{
  "sourceChain": "eip155:42161",
  "sourceTxHash": "0x...",
  "bridgedToken": "USDC",
  "destinationAmount": "100.00",
  "usdcDepositedToPerp": "100.00",
  "transferResult": { "status": "ok" }
}
```

#### `transfer_spot_to_perps`

Moves USDC **within Hypercore** from the spot account to the perp account. Use this when USDC is already on Hyperliquid (e.g. after a manual bridge). Does NOT bridge from external chains.

```json
{ "amountUsdc": "100", "walletId": "optional", "derivationIndex": 0 }
```

#### `open_perp_position`

Opens a perpetual position. Market orders use 10% slippage (IOC). Limit orders rest on the book (GTC).

```json
{
  "market": "BTC",
  "direction": "long",
  "sizeUsd": "500",
  "leverage": 10,
  "orderType": "market",
  "limitPrice": "49000",
  "reduceOnly": false,
  "walletId": "optional"
}
```

#### `close_perp_position`

Closes an open position using a market IOC order. Defaults to 100% close.

```json
{ "market": "BTC", "sizePercent": 50, "walletId": "optional" }
```

#### `cancel_perp_order`

Cancels an open order by ID. Use `get_perp_orders` to get order IDs.

```json
{ "market": "BTC", "orderId": 12345, "walletId": "optional" }
```

#### `update_perp_leverage`

Updates leverage and margin type for a market. Takes effect for new orders.

```json
{ "market": "BTC", "leverage": 5, "marginType": "cross", "walletId": "optional" }
```

#### `withdraw_from_perps`

Moves USDC from the perp account back to the Hyperliquid spot account. Only withdrawable balance can be withdrawn.

```json
{ "amountUsdc": "50", "walletId": "optional", "derivationIndex": 0 }
```

---

## Typical Agent Workflow

```
1. get_perp_markets           → find BTC market, check price
2. get_token_balances         → verify USDC balance on Arbitrum
3. deposit_to_hyperliquid     → bridge 500 USDC from Arbitrum
4. get_perp_account           → confirm 500 USDC in perp account
5. open_perp_position         → 500 USD long BTC at 10x leverage
6. get_perp_positions         → monitor position
7. close_perp_position        → close when done
8. withdraw_from_perps        → move USDC back to spot
```

---

## Implementation Notes

- All write tools sign using the wallet's EVM key via `PhantomClient.ethereumSignTypedData()` with `networkId: "eip155:42161"` (Arbitrum)
- The `PerpsClient` class in `@phantom/perps-client` handles all Hyperliquid-specific logic; MCP tools are thin wrappers
- `createPerpsClient(context, walletId, derivationIndex)` in `utils/perps.ts` derives the EVM address and binds the signing function
- Bridge polling uses 2-second intervals with a 10-minute timeout
- Spot sells use 2% slippage (mirrors wallet2's `BUY_SELL_PRICE_MULTIPLIER = 0.98`)
- USDC transfers to perp apply a 0.1% safety buffer (`× 0.999`) to account for rounding
