# Phantom OpenClaw Plugin

> **⚠️ PREVIEW DISCLAIMER**
>
> This OpenClaw plugin is currently in **preview** and may break or change at any time without notice.
>
> **Always use a separate Phantom account specifically for testing with AI agents. These accounts should not contain significant assets.**
>
> **Phantom makes no guarantees whatsoever around anything your agent may do using this plugin.** Use at your own risk.

Direct integration with Phantom wallet for OpenClaw agents. This plugin wraps the Phantom MCP Server to provide seamless wallet operations including address retrieval, message signing, transaction signing, token transfers, and token swaps.

## Overview

The Phantom OpenClaw Plugin provides native integration with Phantom wallet functionality. Instead of being a generic MCP bridge, it directly integrates the Phantom MCP Server tools as OpenClaw tools, providing a seamless experience for AI agents.

## Quick Start

Get up and running in under 5 minutes:

### Installation Checklist

- [ ] **Step 1:** Get your App ID from [phantom.com/portal](https://phantom.com/portal)
  - Sign in with Gmail or Apple
  - Click "Create App"
  - Go to Dashboard → View App → Redirect URLs
  - Add `http://localhost:8080/callback` as a redirect URL
  - Navigate to "Phantom Connect" tab
  - Copy your App ID

- [ ] **Step 2:** Install the plugin

  ```bash
  openclaw plugins install @phantom/phantom-openclaw-plugin
  ```

- [ ] **Step 3:** Configure in `~/.openclaw/openclaw.json`

  ```json
  {
    "plugins": {
      "enabled": true,
      "entries": {
        "phantom-openclaw-plugin": {
          "enabled": true,
          "config": {
            "PHANTOM_APP_ID": "your_app_id_from_portal"
          }
        }
      }
    }
  }
  ```

- [ ] **Step 4:** Restart OpenClaw

- [ ] **Step 5:** Test with your agent
  ```text
  Ask: "What are my Phantom wallet addresses?"
  ```

**⚠️ Important:** Use the same email address for both the Phantom Portal and OpenClaw authentication!

See [Prerequisites](#prerequisites) below for detailed setup instructions.

## Features

- **Direct Integration**: Built on top of `@phantom/mcp-server` for reliable wallet operations
- **Automatic Authentication**: Handles OAuth flow and session management automatically
- **Type-Safe**: Full TypeScript support with proper type definitions
- **Simple Setup**: Minimal configuration - just enable the plugin and use
- **Perpetuals Trading**: Full Hyperliquid perps support — swap and deposit funds, manage positions, and trade perpetuals

## Prerequisites

Before using this plugin, you **must** obtain an App ID from the Phantom Portal:

1. **Visit the Phantom Portal**: Go to [phantom.com/portal](https://phantom.com/portal)
2. **Sign in**: Use your Gmail or Apple account to sign in
3. **Create an App**: Click "Create App" and fill in the required details
4. **Configure Redirect URL**:
   - Navigate to Dashboard → View App → Redirect URLs
   - Add `http://localhost:8080/callback` as a redirect URL
   - This allows the OAuth callback to work correctly
5. **Get Your App ID**: Navigate to the "Phantom Connect" tab to find your App ID
   - Your app is automatically approved for development use
   - Copy the App ID for the configuration below

**Important:** The email you use to sign in to the Phantom Portal **must match** the email you use when authenticating with the plugin. If these don't match, authentication will fail.

## Installation

```bash
openclaw plugins install @phantom/phantom-openclaw-plugin
```

## Configuration

Configure the plugin in your OpenClaw configuration file (`~/.openclaw/openclaw.json`):

```json
{
  "plugins": {
    "enabled": true,
    "entries": {
      "phantom-openclaw-plugin": {
        "enabled": true,
        "config": {
          "PHANTOM_APP_ID": "your_app_id_from_portal"
        }
      }
    }
  }
}
```

### Configuration Options

- **`PHANTOM_APP_ID`** (required): Your App ID from the Phantom Portal
- **`PHANTOM_CLIENT_SECRET`** (optional): Client secret for confidential clients
- **`PHANTOM_CALLBACK_PORT`** (optional): OAuth callback port (default: 8080)
- **`PHANTOM_MCP_DEBUG`** (optional): Enable debug logging (set to "1")

**Note:** Most users only need to provide `PHANTOM_APP_ID`. The other options are for advanced use cases.

### Troubleshooting: `DCR 404` During Startup

If startup fails with `Failed to register OAuth client` and `status code 404`, OpenClaw likely did not provide a valid `PHANTOM_APP_ID` to the plugin.

Verify your config is nested exactly at:

`plugins.entries["phantom-openclaw-plugin"].config.PHANTOM_APP_ID`

`PHANTOM_APP_ID` values are issued from [phantom.com/portal](https://phantom.com/portal).

## Available Tools

The plugin exposes the following tools from the Phantom MCP Server:

### `get_connection_status`

Lightweight local check of the wallet connection state. No network call — reads session state only. Use this first to confirm the user is authenticated.

**Parameters:** None

### `get_wallet_addresses`

Retrieve wallet addresses for all supported blockchain chains (Solana, Ethereum, Bitcoin, Sui).

**Parameters:**

- `derivationIndex` (number, optional): Derivation index for the wallet (default: 0)

**Example:**

```json
{
  "derivationIndex": 0
}
```

### `get_token_balances`

Get all fungible token balances for the authenticated wallet with live USD prices and 24h price change.

**Parameters:** None

### `send_solana_transaction`

Sign and broadcast a pre-built Solana transaction. Accepts a base64-encoded serialized transaction.

**Parameters:**

- `transaction` (string, required): Base64-encoded serialized Solana transaction
- `networkId` (string, optional): Solana network (default: `"solana:mainnet"`)
- `walletId` (string, optional): Wallet ID (defaults to authenticated wallet)
- `derivationIndex` (number, optional): Derivation index (default: 0)

**Example:**

```json
{
  "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQABAgME..."
}
```

### `sign_solana_message`

Sign a UTF-8 message with the Solana wallet. Returns a base58-encoded signature.

**Parameters:**

- `message` (string, required): The UTF-8 message to sign
- `networkId` (string, required): Solana network (e.g., `"solana:mainnet"`)
- `derivationIndex` (number, optional): Derivation index (default: 0)

**Example:**

```json
{
  "message": "Verify ownership of my wallet",
  "networkId": "solana:mainnet"
}
```

### `send_evm_transaction`

Sign and broadcast an EVM transaction. Nonce, gas, and gasPrice are optional — fetched from the network if omitted.

**Parameters:**

- `chainId` (number, required): EVM chain ID (e.g., `1` for Ethereum, `8453` for Base, `137` for Polygon, `42161` for Arbitrum, `143` for Monad)
- `to` (string, optional): Recipient address
- `value` (string, optional): Amount in wei as hex (e.g., `"0x38D7EA4C68000"`)
- `data` (string, optional): Encoded calldata (0x-prefixed hex)
- `gas`, `gasPrice`, `maxFeePerGas`, `maxPriorityFeePerGas`, `nonce` (string, optional): All auto-fetched if omitted
- `derivationIndex` (number, optional): Derivation index (default: 0)

**Example:**

```json
{
  "chainId": 1,
  "to": "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
  "value": "0x38D7EA4C68000"
}
```

### `sign_evm_personal_message`

Sign a UTF-8 message using EIP-191 `personal_sign` with the EVM wallet. Returns a hex-encoded signature.

**Parameters:**

- `message` (string, required): The UTF-8 message to sign
- `chainId` (number, required): EVM chain ID (e.g., `1` for Ethereum, `8453` for Base, `137` for Polygon, `143` for Monad)
- `derivationIndex` (number, optional): Derivation index (default: 0)

**Example:**

```json
{
  "message": "Sign in to My App\nNonce: 12345",
  "chainId": 1
}
```

### `sign_evm_typed_data`

Sign EIP-712 typed structured data. Used for DeFi permit signatures, order signing (0x, Seaport), and other structured off-chain approvals.

**Parameters:**

- `typedData` (object, required): EIP-712 typed data with `types`, `primaryType`, `domain`, and `message` fields
- `chainId` (number, required): EVM chain ID (e.g., `1` for Ethereum, `8453` for Base, `137` for Polygon, `143` for Monad)
- `derivationIndex` (number, optional): Derivation index (default: 0)

### `transfer_tokens`

Transfer native tokens or fungible tokens on Solana and EVM chains. Builds, signs, and sends the transaction immediately.

**Parameters:**

- `networkId` (string, required): Network — Solana (`"solana:mainnet"`, `"solana:devnet"`) or EVM (`"eip155:1"`, `"eip155:8453"`, `"eip155:137"`, `"eip155:42161"`, `"eip155:143"`)
- `to` (string, required): Recipient — Solana base58 address or EVM `0x`-prefixed address
- `amount` (string, required): Transfer amount (e.g., "0.1" or "1000000")
- `amountUnit` (string, optional): `"ui"` for human-readable units or `"base"` for atomic units. Default: `"ui"`
- `tokenMint` (string, optional): Token contract — Solana SPL mint or EVM ERC-20 `0x` address. Omit for native token.
- `decimals` (number, optional): Token decimals — optional on Solana (auto-fetched); required for ERC-20 with `amountUnit: "ui"`
- `derivationIndex` (number, optional): Derivation index (default: 0)
- `createAssociatedTokenAccount` (boolean, optional): Solana only — create destination ATA if missing (default: true)

**Example (SOL):**

```json
{
  "networkId": "solana:mainnet",
  "to": "H8FpYTgx4Uy9aF9Nk9fCTqKKFLYQ9KfC6UJhMkMDzCBh",
  "amount": "0.1",
  "amountUnit": "ui"
}
```

**Example (ETH on Base):**

```json
{
  "networkId": "eip155:8453",
  "to": "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
  "amount": "0.01",
  "amountUnit": "ui"
}
```

**Example (ERC-20 USDC on Ethereum):**

```json
{
  "networkId": "eip155:1",
  "to": "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
  "tokenMint": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "amount": "100",
  "amountUnit": "ui",
  "decimals": 6
}
```

**⚠️ Warning:** This tool submits transactions immediately and irreversibly.

### `buy_token`

Fetch a swap quote from Phantom's routing engine. Supports same-chain Solana, same-chain EVM, and cross-chain swaps between Solana and EVM chains. Optionally execute immediately.

**Parameters:**

- `sellChainId` (string, optional): CAIP-2 chain for the sell token (default: `"solana:mainnet"`). Supported: `solana:*` and `eip155:*` (e.g. `"eip155:1"`, `"eip155:8453"`).
- `buyChainId` (string, optional): CAIP-2 chain for the buy token (defaults to `sellChainId`). Supported: `solana:*` and `eip155:*`. Set differently for cross-chain.
- `sellTokenIsNative` (boolean, optional): Sell the native token (default: true if sellTokenMint not provided)
- `sellTokenMint` (string, optional): Token to sell — Solana mint or EVM `0x` contract
- `buyTokenIsNative` (boolean, optional): Buy the native token
- `buyTokenMint` (string, optional): Token to buy — Solana mint or EVM `0x` contract
- `amount` (string, required): Swap amount
- `amountUnit` (string, optional): `"ui"` for token units or `"base"` for atomic units. Default: `"base"`
- `slippageTolerance` (number, optional): Slippage tolerance in percent (0-100)
- `execute` (boolean, optional): Sign and send the initiation transaction immediately. For cross-chain swaps (`sellChainId` ≠ `buyChainId`) this sends the source-chain transaction; the bridge completes the destination side automatically. Default: false
- `derivationIndex` (number, optional): Derivation index (default: 0)
- `quoteApiUrl` (string, optional): Phantom-compatible quotes API override. Leave unset for normal use.

**Example (Solana swap):**

```json
{
  "sellChainId": "solana:mainnet",
  "sellTokenIsNative": true,
  "buyTokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amount": "0.5",
  "amountUnit": "ui",
  "slippageTolerance": 1,
  "execute": true
}
```

**Example (EVM swap — ETH → USDC on Base):**

```json
{
  "sellChainId": "eip155:8453",
  "sellTokenIsNative": true,
  "buyTokenMint": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "amount": "1000000000000000000",
  "slippageTolerance": 1,
  "execute": true
}
```

**⚠️ Warning:** When `execute: true`, this tool submits transactions immediately and irreversibly.

---

### Perpetuals Tools (Hyperliquid)

The plugin exposes 12 tools for perpetuals trading on Hyperliquid via Phantom's backend. All signing uses the wallet's EVM key (Arbitrum EIP-712).

#### Read-only

##### `get_perp_account`

Returns perp account balance: `accountValue`, `availableBalance`, `availableToTrade`.

**Parameters:** `walletId` (optional), `derivationIndex` (optional, default 0)

##### `get_perp_markets`

Returns all available perpetual markets with current price, funding rate, open interest, 24h volume, and max leverage.

**Parameters:** `walletId` (optional)

##### `get_perp_positions`

Returns all open positions with direction, size, entry price, leverage, unrealized PnL, and liquidation price.

**Parameters:** `walletId` (optional), `derivationIndex` (optional, default 0)

##### `get_perp_orders`

Returns all open orders (limit, take-profit, stop-loss) with order ID, type, price, size, and reduce-only flag.

**Parameters:** `walletId` (optional), `derivationIndex` (optional, default 0)

##### `get_perp_trade_history`

Returns historical trades with price, size, trade value, fee, and closed PnL.

**Parameters:** `walletId` (optional), `derivationIndex` (optional, default 0)

#### Write

##### `deposit_to_hyperliquid`

Swaps tokens to USDC via Phantom's routing engine and transfers the USDC into the Hyperliquid perp account.

**Parameters:**

- `sourceChainId` (string, required): Source chain — `"solana:mainnet"`, `"eip155:42161"`, `"eip155:8453"`, `"eip155:1"`, or `"eip155:137"`
- `amount` (string, required): Amount to deposit in human-readable units
- `tokenAddress` (string, optional): ERC-20/SPL token address — omit for native SOL or default USDC per chain
- `walletId` (string, optional), `derivationIndex` (number, optional, default 0)

**⚠️ Warning:** Submits transactions immediately and irreversibly.

##### `open_perp_position`

Opens a perpetual position. Market orders use 10% slippage (IOC). Limit orders rest on the book (GTC).

**Parameters:**

- `market` (string, required): Market symbol (e.g. `"BTC"`, `"ETH"`, `"SOL"`)
- `direction` (string, required): `"long"` or `"short"`
- `sizeUsd` (string, required): Notional position size in USD (e.g. `"500"`)
- `leverage` (number, required): Leverage multiplier (e.g. `10` for 10x)
- `orderType` (string, required): `"market"` or `"limit"`
- `limitPrice` (string, optional): Required for limit orders
- `reduceOnly` (boolean, optional): Default false
- `walletId` (string, optional), `derivationIndex` (number, optional, default 0)

**⚠️ Warning:** Submits transactions immediately and irreversibly.

##### `close_perp_position`

Closes an open position using a market IOC order. Defaults to 100% close.

**Parameters:**

- `market` (string, required): Market symbol (e.g. `"BTC"`)
- `sizePercent` (number, optional): Percentage to close (1–100, default 100)
- `walletId` (string, optional), `derivationIndex` (number, optional, default 0)

**⚠️ Warning:** Submits transactions immediately and irreversibly.

##### `cancel_perp_order`

Cancels an open order by ID. Use `get_perp_orders` to retrieve order IDs.

**Parameters:**

- `market` (string, required): Market symbol
- `orderId` (number, required): Order ID from `get_perp_orders`
- `walletId` (string, optional), `derivationIndex` (number, optional, default 0)

##### `update_perp_leverage`

Updates leverage and margin type for a market. Takes effect on new orders.

**Parameters:**

- `market` (string, required): Market symbol
- `leverage` (number, required): New leverage multiplier
- `marginType` (string, required): `"isolated"` or `"cross"`
- `walletId` (string, optional), `derivationIndex` (number, optional, default 0)

##### `transfer_spot_to_perps`

Moves USDC **within Hypercore** from the spot account to the perp account. Use when USDC is already on Hyperliquid. Does not bridge from external chains.

**Parameters:**

- `amountUsdc` (string, required): Amount of USDC to transfer
- `walletId` (string, optional), `derivationIndex` (number, optional, default 0)

##### `withdraw_from_perps`

Moves USDC from the perp account back to the Hyperliquid spot account.

**Parameters:**

- `amountUsdc` (string, required): Amount of USDC to withdraw
- `walletId` (string, optional), `derivationIndex` (number, optional, default 0)

#### Typical Agent Workflow

```text
1. get_perp_markets          → find market, check price
2. get_token_balances        → verify USDC balance on source chain
3. deposit_to_hyperliquid    → swap to USDC and deposit to perp account
4. get_perp_account          → confirm balance in perp account
5. open_perp_position        → open long at 10x leverage
6. get_perp_positions        → monitor position
7. close_perp_position       → close when done
8. withdraw_from_perps       → move USDC back to spot
```

---

## Network IDs Reference

Network identifiers follow the CAIP-2/CAIP-10 format. Here are the supported networks:

### Solana

- Mainnet: `solana:mainnet`
- Devnet: `solana:devnet`
- Testnet: `solana:testnet`

### Ethereum / EVM Chains

- Ethereum Mainnet: `eip155:1`
- Ethereum Sepolia: `eip155:11155111`
- Polygon Mainnet: `eip155:137`
- Polygon Amoy: `eip155:80002`
- Base Mainnet: `eip155:8453`
- Base Sepolia: `eip155:84532`
- Arbitrum One: `eip155:42161`
- Arbitrum Sepolia: `eip155:421614`

### Bitcoin

- Mainnet: `bip122:000000000019d6689c085ae165831e93`

### Sui

- Mainnet: `sui:mainnet`
- Testnet: `sui:testnet`

## Authentication

On first use, the plugin will automatically initiate the Phantom OAuth flow:

1. A browser window will open to `https://connect.phantom.app`
2. Sign in with your Google or Apple account
   - **Important:** Use the same email you used to sign in to the Phantom Portal
3. Authorize the application
4. The session will be saved for future use

Sessions are stored securely in `~/.phantom-mcp/session.json` with restricted permissions and persist across restarts. The plugin uses stamper keypair authentication which doesn't expire.

## Usage Examples

### Check Wallet Addresses

```text
User: What are my wallet addresses?
Agent: Let me check your Phantom wallet addresses.
[Calls get_wallet_addresses]
```

### Sign a Message

```text
User: Sign this message: "Verify ownership of my wallet"
Agent: I'll sign that message for you using your Phantom wallet.
[Calls sign_message with the message]
```

### Sign a Transaction

```text
User: Sign this Solana transaction: [transaction data]
Agent: I'll sign that transaction with your Phantom wallet.
[Calls sign_transaction with the transaction data]
```

## Architecture

```text
phantom-openclaw-plugin/
├── src/
│   ├── index.ts              # Plugin entry point
│   ├── session.ts            # Session management wrapper
│   ├── client/
│   │   └── types.ts          # OpenClaw API types
│   └── tools/
│       └── register-tools.ts # Tool registration logic
├── skills/
│   └── phantom-wallet/       # Wallet operations skill
└── openclaw.plugin.json      # Plugin manifest
```

## Development

For contributors or those testing unreleased versions.

### Prerequisites

- Node.js 18+
- yarn
- Phantom wallet account for testing
- App ID from [Phantom Portal](https://phantom.com/portal)

### Local Installation

1. Clone and build the plugin:

   ```bash
   # From the phantom-connect-sdk repository root
   yarn install
   yarn workspace @phantom/mcp-server build
   yarn workspace @phantom/phantom-openclaw-plugin build
   ```

2. Install locally into OpenClaw:

   ```bash
   openclaw plugins install -l ./packages/phantom-openclaw-plugin
   ```

3. Configure in `~/.openclaw/openclaw.json`:

   ```json
   {
     "plugins": {
       "enabled": true,
       "entries": {
         "phantom-openclaw-plugin": {
           "enabled": true,
           "config": {
             "PHANTOM_APP_ID": "your_app_id_from_portal"
           }
         }
       }
     }
   }
   ```

4. Verify installation:

   ```bash
   openclaw plugins list
   ```

5. Test with an agent:
   ```bash
   openclaw chat
   > What are my Phantom wallet addresses?
   ```

### Build Commands

```bash
# Build the plugin
yarn build

# Development mode with watch
yarn dev

# Type checking
yarn check-types

# Linting
yarn lint

# Format code
yarn prettier
```

## Troubleshooting

### Plugin Not Loading

- Verify the plugin is enabled in `openclaw.json`
- Check that the build completed successfully (`dist/` directory exists)
- Ensure both the plugin and `@phantom/mcp-server` are built

### Authentication Fails

- Check your internet connection
- Ensure you have a Phantom wallet account
- Try clearing the session cache: `rm -rf ~/.phantom-mcp/session.json`
- Check the console logs for specific error messages

### Tool Execution Errors

- Ensure you're authenticated (the plugin will prompt if not)
- Verify the tool parameters match the expected schema
- Check that the Phantom wallet supports the requested operation

## Related Projects

- [@phantom/mcp-server](../mcp-server) - The underlying MCP server providing wallet functionality
- [Phantom Wallet](https://phantom.app) - The Phantom wallet application

## Contributing

Contributions are welcome! Please ensure:

- TypeScript types are properly defined
- Code follows the existing style (run `yarn prettier`)
- All builds pass (`yarn build`)
- Type checking passes (`yarn check-types`)

## License

MIT

## Support

For issues or questions:

- GitHub Issues: https://github.com/phantom/phantom-connect-sdk/issues
- Phantom Support: https://help.phantom.app
