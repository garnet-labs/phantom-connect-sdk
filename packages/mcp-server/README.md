# @phantom/mcp-server

An MCP (Model Context Protocol) server that provides LLMs like Claude with direct access to Phantom wallet operations. This enables AI assistants to interact with embedded wallets, view addresses, simulate transactions, check token approvals, sign and send transactions, and sign messages across Solana and EVM chains through natural language interactions.

## Features

- **Device-code Authentication**: Browser-based Phantom sign-in with device authorization by default
- **Session Persistence**: Automatic session management with stamper keys stored in `~/.phantom-mcp/session.json`
- **Auto Re-authentication**: On session expiry (401/403), the server automatically triggers re-auth and retries the tool call
- **Multi-Chain Support**: Solana and EVM chains (Ethereum, Base, Polygon, Arbitrum, and more)
- **Simulation-First Safety Flows**: `send_solana_transaction`, `send_evm_transaction`, and `transfer_tokens` can preview expected changes before submitting
- **Token Approval Checks**: `get_token_allowance` lets agents determine when an ERC-20 approval is required before an EVM swap or contract interaction
- **Chain-Specific Tools** (mirrors the browser-sdk API pattern):
  - `get_connection_status` - Lightweight local check of wallet connection state (no API call)
  - `get_wallet_addresses` - Get Solana, Ethereum, Bitcoin, and Sui addresses for the authenticated wallet
  - `get_token_balances` - Get all fungible token balances with live USD prices
  - `send_solana_transaction` - Sign and broadcast a pre-built Solana transaction
  - `send_evm_transaction` - Sign and broadcast an EVM transaction (auto-fills nonce, gas, gasPrice)
  - `sign_solana_message` - Sign a UTF-8 message on Solana
  - `sign_evm_personal_message` - Sign a UTF-8 message via EIP-191 personal_sign on any EVM network
  - `sign_evm_typed_data` - Sign EIP-712 typed structured data (DeFi permits, order signing)
  - `get_token_allowance` - Check the ERC-20 allowance granted by an owner to a spender on any EVM chain
  - `transfer_tokens` - Transfer native tokens or fungible tokens on Solana and EVM chains (builds, signs, and sends)
  - `buy_token` - Fetch a swap quote from Phantom's routing engine for Solana, EVM, and cross-chain swaps (optionally executes)
  - `simulate_transaction` - Preview expected asset changes, warnings, and blocks for a transaction without submitting it on-chain
- **Perpetuals Trading** (Hyperliquid via Phantom backend — see [PERPS.md](./PERPS.md) for full docs):
  - `deposit_to_hyperliquid` - Bridge tokens from Solana/EVM into Hyperliquid perp account (full flow)
  - `get_perp_account` - Perp account balance and available margin
  - `get_perp_markets` - Available markets with price, funding rate, open interest, and max leverage
  - `get_perp_positions` - Open positions with size, entry price, leverage, unrealized PnL, and liquidation price
  - `get_perp_orders` - Open limit, take-profit, and stop-loss orders
  - `get_perp_trade_history` - Historical fills with fee and closed PnL
  - `open_perp_position` - Open a market or limit long/short with configurable leverage
  - `close_perp_position` - Full or partial position close via market order
  - `cancel_perp_order` - Cancel an open order by ID
  - `update_perp_leverage` - Change leverage and margin type (isolated/cross)
  - `transfer_spot_to_perps` - Move USDC from Hypercore spot to perp account
  - `withdraw_from_perps` - Move USDC from Hypercore perp back to spot account

## Installation

### Option 1: npx (Recommended)

Use npx to run the server without global installation. This ensures you always use the latest version:

```bash
npx -y @phantom/mcp-server@latest
```

### Option 2: Global Install

Install the package globally for faster startup:

```bash
npm install -g @phantom/mcp-server@latest
```

Then run:

```bash
phantom-mcp
```

## Usage

### Claude Desktop Configuration

Add the MCP server to your Claude Desktop configuration file:

**Location:**

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

**Using npx (Recommended):**

```json
{
  "mcpServers": {
    "phantom": {
      "command": "npx",
      "args": ["-y", "@phantom/mcp-server@latest"]
    }
  }
}
```

**Using global install:**

```json
{
  "mcpServers": {
    "phantom": {
      "command": "phantom-mcp"
    }
  }
}
```

After updating the config, restart Claude Desktop to load the server.

### Environment Variables

Most users do not need to set any environment variables.

Optional runtime configuration:

- `PHANTOM_AUTH_BASE_URL` - Override the Phantom auth base URL
- `PHANTOM_CONNECT_BASE_URL` - Override the Phantom Connect base URL
- `PHANTOM_WALLETS_API_BASE_URL` - Override the Phantom wallets/KMS API base URL
- `PHANTOM_API_BASE_URL` - Override the Phantom API base URL used by tool calls
- `PHANTOM_VERSION` - Override the version header sent with requests
- `PHANTOM_MCP_DEBUG` - Enable debug logging (set to `1` or `true`)

### Authentication Flow

On first run, the server will:

1. **Device-code authentication**: By default, start Phantom's device authorization flow
2. **Browser sign-in**: Open your default browser so you can sign in with Google or Apple and approve the wallet session
3. **Session storage**: Save your session to `~/.phantom-mcp/session.json`

The session file is secured with restrictive permissions (0o600) and contains:

- Wallet and organization identifiers
- Authentication/session metadata used for subsequent wallet operations
- User authentication details

Sessions persist across restarts until they are deleted or rejected server-side, at which point the MCP server automatically triggers re-authentication.

## Migrating

If you previously used `@phantom/mcp-server` version `0.2.4` or earlier, the wallet model has changed.

In older versions, connecting the MCP server connected the agent to your existing user wallet.

In current versions, agents receive a new wallet when they authenticate. That means:

- Existing prompts or workflows that assumed access to your personal wallet may no longer behave the same way.
- Newly authenticated agents must be funded before they can transfer tokens, swap, or perform other on-chain actions.
- You should check the current wallet address with `get_wallet_addresses` after authenticating and fund that wallet before attempting transactions.

### Manual Testing

Test the server directly using the MCP inspector:

```bash
npx @modelcontextprotocol/inspector npx -y @phantom/mcp-server@latest
```

This opens an interactive web UI where you can test tool calls without Claude Desktop.

## Network IDs Reference

### Solana

Solana tools (`send_solana_transaction`, `sign_solana_message`) and the Solana path of `transfer_tokens` and `buy_token` use CAIP-2 network IDs:

- Mainnet: `solana:mainnet` (or `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`)
- Devnet: `solana:devnet` (or `solana:GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69`)
- Testnet: `solana:testnet` (or `solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z`)

### Ethereum / EVM Chains

All EVM tools (`send_evm_transaction`, `sign_evm_personal_message`, `sign_evm_typed_data`) use a plain numeric `chainId` — the same field returned by DeFi aggregators like LI.FI and 1inch:

| Network          | `chainId`  |
| ---------------- | ---------- |
| Ethereum Mainnet | `1`        |
| Ethereum Sepolia | `11155111` |
| Polygon Mainnet  | `137`      |
| Polygon Amoy     | `80002`    |
| Base Mainnet     | `8453`     |
| Base Sepolia     | `84532`    |
| Arbitrum One     | `42161`    |
| Arbitrum Sepolia | `421614`   |
| Monad Mainnet    | `143`      |
| Monad Testnet    | `10143`    |

### Bitcoin

- Mainnet: `bip122:000000000019d6689c085ae165831e93`

### Sui

- Mainnet: `sui:mainnet`
- Testnet: `sui:testnet`

## Available Tools

### 1. get_connection_status

Lightweight check of the current Phantom wallet connection state. Does not make any network or API calls — reads local session state only. Use this to confirm the user is authenticated before other operations.

**Parameters:** None

**Response (connected):**

```json
{
  "connected": true,
  "walletId": "05307b6d-2d5a-43d6-8d11-08db650a169b",
  "organizationId": "9b0ea123-5e7f-4dbe-88c5-7d769e2f8c8e"
}
```

**Response (not connected):**

```json
{
  "connected": false,
  "reason": "No active session found. Call get_wallet_addresses to authenticate."
}
```

### 2. get_wallet_addresses

Gets all blockchain addresses for the authenticated embedded wallet (Solana, Ethereum, Bitcoin, Sui). Call this first to discover the wallet's addresses before using the chain-specific tools.

**Parameters:**

- `derivationIndex` (optional, number): Derivation index for the addresses (default: 0)

**Example:**

```json
{
  "derivationIndex": 0
}
```

**Response:**

```json
{
  "walletId": "05307b6d-2d5a-43d6-8d11-08db650a169b",
  "organizationId": "9b0ea123-5e7f-4dbe-88c5-7d769e2f8c8e",
  "addresses": [
    { "addressType": "solana", "address": "H8FpYTgx4Uy9aF9Nk9fCTqKKFLYQ9KfC6UJhMkMDzCBh" },
    { "addressType": "ethereum", "address": "0x8d8b06e017944f5951418b1182d119a376efb39d" },
    { "addressType": "BitcoinSegwit", "address": "bc1qkce5fvaxe759yu5xle5axlh8c7durjsx2wfhr9" },
    { "addressType": "sui", "address": "0x039039cf69a336cb84e4c1dbcb3fa0c3f133d11b8146c6f7ed0d9f6817529a62" }
  ]
}
```

---

### 3. get_token_balances

Returns all fungible token balances (SOL + SPL tokens, and other chain tokens) for the authenticated wallet, with live USD prices and 24h price change.

**Parameters:** None — automatically uses the authenticated wallet's Solana address.

**Response:**

```json
{
  "items": [
    {
      "__typename": "FungibleBalance",
      "id": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501",
      "caip19": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501",
      "name": "Solana",
      "symbol": "SOL",
      "decimals": 9,
      "spamStatus": "VERIFIED",
      "logoUri": "https://...",
      "totalQuantity": 1.5,
      "totalQuantityString": "1500000000",
      "price": {
        "price": 142.53,
        "priceChange24h": -2.31,
        "lastUpdatedAt": "2026-03-03T12:00:00.000Z"
      },
      "queriedWalletBalances": [
        {
          "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
          "quantity": 1.5,
          "quantityString": "1500000000"
        }
      ]
    }
  ],
  "cursor": "eyJhbGci..."
}
```

To extract the mint address of an SPL token from `caip19`, take the part after `/token:`.

---

### 4. send_solana_transaction

Signs and broadcasts a Solana transaction. Accepts a standard base64-encoded serialized transaction — the same format used by the Solana JSON-RPC API and returned by DeFi APIs (Jupiter, Phantom swap, etc.).

**Two-step safety flow:** By default (omitting `confirmed`), the tool runs a simulation via Phantom's transaction simulation service and returns the expected asset changes and any warnings — without broadcasting anything. The agent should present these results to the user and ask for confirmation before proceeding. Pass `confirmed: true` on the second call to actually sign and send.

If you want to skip simulation and execute immediately, pass `confirmed: true` on the first call — but prefer the two-step flow for user safety.

**Parameters:**

- `transaction` (required, string): Base64-encoded serialized Solana transaction (standard Solana JSON-RPC format — not base58)
- `networkId` (optional, string): Solana network (e.g., `"solana:mainnet"`, `"solana:devnet"`). Defaults to `"solana:mainnet"`.
- `walletId` (optional, string): Wallet ID to use (defaults to authenticated wallet)
- `derivationIndex` (optional, number): Derivation index (default: 0)
- `confirmed` (optional, boolean): Set to `true` only after the user has reviewed and approved the simulation. Omit on the first call to get a preview without submitting.

**Step 1 — simulate (omit `confirmed`):**

```json
{
  "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQABAgME..."
}
```

**Step 1 response:**

```json
{
  "status": "pending_confirmation",
  "simulation": {
    "expectedChanges": [{ "type": "AssetChange", "changeSign": "MINUS", "changeText": "-0.5 SOL" }],
    "warnings": [],
    "block": null
  }
}
```

If simulation fails, the tool still returns `"status": "pending_confirmation"` with `"simulation": null`.

**Step 2 — execute (after user approves):**

```json
{
  "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQABAgME...",
  "confirmed": true
}
```

**Step 2 response:**

```json
{
  "signature": "5oVZJ8b7k2rGm3rP3Gm5J3tFjR6eUpCkG6TGNKxgqQ7s...",
  "networkId": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "account": "H8FpYTgx4Uy9aF9Nk9fCTqKKFLYQ9KfC6UJhMkMDzCBh"
}
```

---

### 5. send_evm_transaction

Signs and broadcasts an EVM transaction using the standard `eth_sendTransaction` format. Pass in the transaction fields you know; `nonce`, `gas`, and `gasPrice` are optional — the server fetches any missing values from the network automatically via the RPC endpoint.

**Two-step safety flow:** By default (omitting `confirmed`), the tool runs a simulation via Phantom's transaction simulation service and returns the expected asset changes and any warnings — without broadcasting anything. The agent should present these results to the user and ask for confirmation before proceeding. Pass `confirmed: true` on the second call to actually sign and send.

If you want to skip simulation and execute immediately, pass `confirmed: true` on the first call — but prefer the two-step flow for user safety.

Use `chainId` (a plain number) to identify the network — this matches the `chainId` field returned directly by DeFi aggregators like LI.FI and 1inch. Built-in public RPC defaults for Ethereum mainnet, Base, Polygon, Arbitrum, and testnets; pass `rpcUrl` to override.

**Parameters:**

- `chainId` (required, number): EVM chain ID (e.g., `1` for Ethereum mainnet, `8453` for Base, `137` for Polygon, `42161` for Arbitrum). Use the `chainId` field directly from aggregator responses like LI.FI or 1inch.
- `to` (optional, string): Recipient address (0x-prefixed)
- `value` (optional, string): Amount in wei as a hex string (e.g., `"0x38D7EA4C68000"` for 0.001 ETH)
- `data` (optional, string): Encoded contract call data (0x-prefixed hex). Omit for plain ETH transfers.
- `gas` (optional, string): Gas limit as hex (e.g., `"0x5208"` for 21 000). Corresponds to `gasLimit` in LI.FI responses. If omitted, estimated via `eth_estimateGas` with a 20% buffer.
- `gasPrice` (optional, string): Gas price in wei as hex (legacy transactions). If neither `gasPrice` nor `maxFeePerGas` is provided, fetched via `eth_gasPrice`.
- `maxFeePerGas` (optional, string): Maximum total fee per gas in wei as hex (EIP-1559)
- `maxPriorityFeePerGas` (optional, string): Maximum priority fee (tip) per gas in wei as hex (EIP-1559)
- `nonce` (optional, string): Transaction nonce as hex. If omitted, fetched via `eth_getTransactionCount`.
- `type` (optional, string): Transaction type (`"0x0"` for legacy, `"0x2"` for EIP-1559)
- `walletId` (optional, string): Wallet ID to use (defaults to authenticated wallet)
- `derivationIndex` (optional, number): Derivation index (default: 0)
- `rpcUrl` (optional, string): Custom RPC endpoint. See default RPC table below.
- `confirmed` (optional, boolean): Set to `true` only after the user has reviewed and approved the simulation. Omit on the first call to get a preview without submitting.

**Step 1 — simulate (omit `confirmed`):**

```json
{
  "chainId": 1,
  "to": "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
  "value": "0x38D7EA4C68000"
}
```

**Step 1 response:**

```json
{
  "status": "pending_confirmation",
  "simulation": {
    "expectedChanges": [{ "type": "AssetChange", "changeSign": "MINUS", "changeText": "-0.001 ETH" }],
    "warnings": [],
    "block": null
  }
}
```

If simulation fails, the tool still returns `"status": "pending_confirmation"` with `"simulation": null`.

**Step 2 — execute (after user approves):**

```json
{
  "chainId": 1,
  "to": "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
  "value": "0x38D7EA4C68000",
  "confirmed": true
}
```

**Step 2 response:**

```json
{
  "hash": "0xabc123...",
  "networkId": "eip155:1",
  "from": "0x8d8b06e017944f5951418b1182d119a376efb39d",
  "to": "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E"
}
```

**Other examples:**

```json
{
  "chainId": 8453,
  "to": "0x...",
  "value": "0xDE0B6B3A7640000",
  "maxFeePerGas": "0x6FC23AC00",
  "maxPriorityFeePerGas": "0x77359400",
  "confirmed": true
}
```

**Supported chain IDs and default RPC URLs:**

| Network          | `chainId`  | Default RPC                    |
| ---------------- | ---------- | ------------------------------ |
| Ethereum Mainnet | `1`        | `https://cloudflare-eth.com`   |
| Base Mainnet     | `8453`     | `https://mainnet.base.org`     |
| Ethereum Sepolia | `11155111` | `https://sepolia.drpc.org`     |
| Base Sepolia     | `84532`    | `https://sepolia.base.org`     |
| Polygon Mainnet  | `137`      | `https://polygon-rpc.com`      |
| Arbitrum One     | `42161`    | `https://arb1.arbitrum.io/rpc` |

---

### 6. sign_solana_message

Signs a UTF-8 message with the Solana wallet. Returns a base58-encoded signature.

Mirrors `sdk.solana.signMessage(message)` from the browser-sdk.

**Parameters:**

- `message` (required, string): The UTF-8 message to sign
- `networkId` (required, string): Solana network (e.g., `"solana:mainnet"`)
- `walletId` (optional, string): Wallet ID (defaults to authenticated wallet)
- `derivationIndex` (optional, integer): Derivation index (default: 0)

**Example:**

```json
{
  "message": "Please sign this message to verify your wallet ownership.",
  "networkId": "solana:mainnet"
}
```

**Response:**

```json
{
  "signature": "3XF1..."
}
```

---

### 7. sign_evm_personal_message

Signs a UTF-8 message using EIP-191 `personal_sign` with the EVM wallet. Returns a hex-encoded signature.

Mirrors `sdk.ethereum.signPersonalMessage(message, address)` from the browser-sdk.

**Parameters:**

- `message` (required, string): The UTF-8 message to sign
- `chainId` (required, number): EVM chain ID (e.g., `1` for Ethereum mainnet, `8453` for Base, `137` for Polygon, `143` for Monad)
- `walletId` (optional, string): Wallet ID (defaults to authenticated wallet)
- `derivationIndex` (optional, integer): Derivation index (default: 0)

**Example:**

```json
{
  "message": "Sign in to My App\nNonce: 12345",
  "chainId": 1
}
```

**Example on Base:**

```json
{
  "message": "Verify wallet ownership",
  "chainId": 8453
}
```

**Response:**

```json
{
  "signature": "0x1b3a..."
}
```

---

### 8. sign_evm_typed_data

Signs EIP-712 typed structured data with the EVM wallet. Returns a hex-encoded signature. Used for DeFi permit signatures, off-chain order signing (0x, Seaport, Uniswap permit2), and other structured off-chain approvals.

Mirrors `sdk.ethereum.signTypedData(typedData, address)` from the browser-sdk.

**Parameters:**

- `typedData` (required, object): EIP-712 typed data with the following fields:
  - `types` (object): Type definitions mapping type names to arrays of `{name, type}` fields
  - `primaryType` (string): The primary type to sign (must be a key in `types`)
  - `domain` (object): EIP-712 domain separator (e.g., `name`, `version`, `chainId`, `verifyingContract`)
  - `message` (object): The structured data to sign, conforming to `primaryType`
- `chainId` (required, number): EVM chain ID (e.g., `1` for Ethereum mainnet, `8453` for Base, `137` for Polygon, `143` for Monad)
- `walletId` (optional, string): Wallet ID (defaults to authenticated wallet)
- `derivationIndex` (optional, integer): Derivation index (default: 0)

**Example — EIP-712 permit signature:**

```json
{
  "typedData": {
    "types": {
      "EIP712Domain": [
        { "name": "name", "type": "string" },
        { "name": "version", "type": "string" },
        { "name": "chainId", "type": "uint256" },
        { "name": "verifyingContract", "type": "address" }
      ],
      "Permit": [
        { "name": "owner", "type": "address" },
        { "name": "spender", "type": "address" },
        { "name": "value", "type": "uint256" },
        { "name": "nonce", "type": "uint256" },
        { "name": "deadline", "type": "uint256" }
      ]
    },
    "primaryType": "Permit",
    "domain": {
      "name": "USD Coin",
      "version": "2",
      "chainId": 1,
      "verifyingContract": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    },
    "message": {
      "owner": "0x8d8b06e017944f5951418b1182d119a376efb39d",
      "spender": "0x1111111254EEB25477B68fb85Ed929f73A960582",
      "value": "1000000000",
      "nonce": 0,
      "deadline": 1893456000
    }
  },
  "chainId": 1
}
```

**Response:**

```json
{
  "signature": "0x4f8a..."
}
```

---

### 9. get_token_allowance

Returns the ERC-20 token allowance granted by an owner address to a spender address on any supported EVM chain. Use this before a swap to check whether an `approve()` transaction is needed. When `ownerAddress` is omitted, the authenticated wallet address is used automatically.

**Parameters:**

- `chainId` (required, number | string): EVM chain ID (e.g. `8453` for Base, `1` for Ethereum, `137` for Polygon). Accepts a number, decimal string, or hex string (e.g. `"0x2105"`).
- `tokenAddress` (required, string): ERC-20 token contract address (0x-prefixed).
- `spenderAddress` (required, string): Address of the spender to check allowance for (e.g. a swap router or bridge contract).
- `ownerAddress` (optional, string): Address of the token owner. Defaults to the authenticated wallet address.
- `walletId` (optional, string): Wallet ID (defaults to authenticated wallet). Only used when `ownerAddress` is omitted.
- `derivationIndex` (optional, integer): Derivation index (default: 0). Only used when `ownerAddress` is omitted.
- `rpcUrl` (optional, string): Custom RPC URL override.

**Example:**

```json
{
  "chainId": 8453,
  "tokenAddress": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "spenderAddress": "0x0000000000001ff3684f28c67538d4d072c22734"
}
```

**Response:**

```json
{
  "chainId": 8453,
  "tokenAddress": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "ownerAddress": "0xee8a534eacb5f81dbd8ad163125dfe5f496b0278",
  "spenderAddress": "0x0000000000001ff3684f28c67538d4d072c22734",
  "allowance": "2066891",
  "allowanceHex": "0x1f91cb"
}
```

---

### 10. transfer_tokens

Transfers native tokens or fungible tokens on Solana and EVM chains. This tool uses a two-step flow by default: first simulate and preview, then send only after explicit approval.

**Parameters:**

- `walletId` (optional, string): Wallet ID to use (defaults to authenticated wallet)
- `networkId` (required, string): Network — Solana (`"solana:mainnet"`, `"solana:devnet"`) or EVM (`"eip155:1"`, `"eip155:8453"`, `"eip155:137"`, `"eip155:42161"`, `"eip155:143"`)
- `to` (required, string): Recipient address — Solana base58 or EVM `0x`-prefixed
- `amount` (required, string|number): Transfer amount
- `amountUnit` (optional, string): `"ui"` for human-readable units, `"base"` for atomic units (default: `"ui"`)
- `tokenMint` (optional, string): Token contract — Solana SPL mint address or EVM ERC-20 `0x` contract. Omit for native token.
- `decimals` (optional, number): Token decimals — optional on Solana (auto-fetched); required for ERC-20 when `amountUnit` is `"ui"`
- `derivationIndex` (optional, number): Derivation index (default: 0)
- `rpcUrl` (optional, string): RPC URL override (Solana or EVM)
- `createAssociatedTokenAccount` (optional, boolean): Solana only — create destination ATA if missing (default: `true`)
- `confirmed` (optional, boolean): Set to `true` only after the user has reviewed and approved the simulation. Omit on the first call to get a preview without submitting.

**Example — SOL transfer:**

```json
{
  "networkId": "solana:mainnet",
  "to": "H8FpYTgx4Uy9aF9Nk9fCTqKKFLYQ9KfC6UJhMkMDzCBh",
  "amount": "0.1",
  "amountUnit": "ui"
}
```

**Example — ETH transfer on Base:**

```json
{
  "networkId": "eip155:8453",
  "to": "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
  "amount": "0.01",
  "amountUnit": "ui"
}
```

**Example — ERC-20 (USDC on Ethereum):**

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

**Step 1 — simulate (omit `confirmed`):**

```json
{
  "status": "pending_confirmation",
  "simulation": {
    "expectedChanges": [],
    "warnings": [],
    "block": null
  }
}
```

If `simulation.block` is present, do not proceed until the blocking issue is resolved.

**Step 2 — execute (after user approves):**

```json
{
  "walletId": "05307b6d-2d5a-43d6-8d11-08db650a169b",
  "networkId": "eip155:8453",
  "from": "0x8d8b06e017944f5951418b1182d119a376efb39d",
  "to": "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
  "tokenMint": null,
  "signature": "0xabc123...",
  "rawTransaction": "0xrlpencoded..."
}
```

For EVM token transfers to contracts and swap flows, use `get_token_allowance` first when you need to know whether an ERC-20 `approve()` transaction is required.

---

### 11. buy_token

Fetches an optimized swap quote from Phantom's routing engine. Supports same-chain Solana, same-chain EVM, and cross-chain swaps between Solana and EVM chains. Optionally signs and sends the first quote transaction immediately.

**Parameters:**

- `walletId` (optional, string): Wallet ID (defaults to authenticated wallet)
- `sellChainId` (optional, string): CAIP-2 chain ID for the sell token (default: `"solana:mainnet"`). Supported: `solana:*` and `eip155:*` (e.g. `"eip155:1"`, `"eip155:8453"`, `"eip155:137"`).
- `buyChainId` (optional, string): CAIP-2 chain ID for the buy token (defaults to `sellChainId`). Supported: `solana:*` and `eip155:*`. Set a different value for cross-chain swaps.
- `buyTokenMint` (optional, string): Token to buy — Solana mint address or EVM `0x` contract. Omit for native token.
- `buyTokenIsNative` (optional, boolean): Set `true` to buy the native token
- `sellTokenMint` (optional, string): Token to sell — Solana mint address or EVM `0x` contract. Omit for native token.
- `sellTokenIsNative` (optional, boolean): Set `true` to sell the native token (default: `true` if `sellTokenMint` not provided)
- `amount` (required, string|number): Amount to swap
- `amountUnit` (optional, string): `"ui"` for token units, `"base"` for atomic units (default: `"base"`)
- `sellTokenDecimals` (optional, number): Required for EVM tokens when `amountUnit` is `"ui"`
- `buyTokenDecimals` (optional, number): Required for EVM tokens when `amountUnit` is `"ui"` and `exactOut` is `true`
- `slippageTolerance` (optional, number): Slippage tolerance in percent (0–100)
- `exactOut` (optional, boolean): Treat `amount` as the buy amount instead of sell amount
- `autoSlippage` (optional, boolean): Enable auto slippage calculation
- `execute` (optional, boolean): Sign and send the initiation transaction immediately. For cross-chain swaps this sends the source-chain transaction; the bridge completes the destination side automatically.
- `taker` (optional, string): Override taker address
- `rpcUrl` (optional, string): Solana RPC URL (for Solana decimals lookup when `amountUnit` is `"ui"`)
- `quoteApiUrl` (optional, string): Phantom-compatible quotes API URL override
- `derivationIndex` (optional, number): Derivation index (default: 0)

**Example — Solana swap:**

```json
{
  "sellChainId": "solana:mainnet",
  "sellTokenIsNative": true,
  "buyTokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amount": "0.1",
  "amountUnit": "ui",
  "slippageTolerance": 1,
  "execute": true
}
```

**Example — EVM swap (ETH → USDC on Base):**

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

**Example — cross-chain quote (SOL → ETH):**

```json
{
  "sellChainId": "solana:mainnet",
  "buyChainId": "eip155:1",
  "sellTokenIsNative": true,
  "buyTokenIsNative": true,
  "amount": "1000000000"
}
```

**Cross-chain response (`execute` absent or `false`):**

```json
{
  "quoteRequest": {
    "taker": { "chainId": "solana:101", "resourceType": "address", "address": "H8FpYTgx4Uy..." },
    "takerDestination": { "chainId": "eip155:1", "resourceType": "address", "address": "0x8d8b06e0..." },
    "chainAddresses": {
      "solana:101": "H8FpYTgx4Uy9aF9Nk9fCTqKKFLYQ9KfC6UJhMkMDzCBh",
      "eip155:1": "0x8d8b06e017944f5951418b1182d119a376efb39d"
    },
    "sellToken": { "chainId": "solana:101", "resourceType": "nativeToken", "slip44": "501" },
    "buyToken": { "chainId": "eip155:1", "resourceType": "nativeToken", "slip44": "60" },
    "sellAmount": "1000000000"
  },
  "quoteResponse": {
    "quotes": [
      {
        "sellAmount": "1000000000",
        "buyAmount": "5800000000000000",
        "steps": [
          {
            "chainId": "solana:101",
            "type": "initiation",
            "tool": { "name": "Relay", "logoUri": "https://..." },
            "transactionData": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQABAgME...",
            "estimatedGas": "5000",
            "requiredApprovals": []
          },
          {
            "chainId": "eip155:1",
            "type": "completion",
            "tool": { "name": "Relay", "logoUri": "https://..." },
            "estimatedGas": "21000"
          }
        ]
      }
    ]
  }
}
```

The steps array inside `quoteResponse.quotes[0].steps` describes the full bridge sequence:

- **Step 0** (`"chainId": sellChainId`) — the initiation transaction. When `execute: true`, this is signed and sent automatically. When `execute: false`, `transactionData` contains the serialized transaction for you to submit manually.
- **Step 1+** (`"chainId": buyChainId`) — completion steps executed automatically by the bridge on the destination chain; no action required from the caller either way.

**Response (`execute: true`, works for both same-chain and cross-chain):**

```json
{
  "quoteRequest": { "...": "..." },
  "quoteResponse": { "quotes": [{ "transactionData": ["..."] }] },
  "execution": {
    "signature": "0xabc123...",
    "rawTransaction": "0xrlpencoded..."
  }
}
```

For EVM swaps, use `get_token_allowance` before execution when you need to determine whether the sell token requires an ERC-20 approval. Quote responses may also include `requiredApprovals` on swap steps when relevant.

---

### 12. simulate_transaction

Simulates a transaction and returns expected asset changes, security warnings, and blocking conditions — without submitting it on-chain. Use this to preview what a transaction will do before signing or sending. Supports Solana, EVM (Ethereum, Base, Polygon, Arbitrum, Monad), Sui, and Bitcoin. Built on top of Phantom's transaction simulation service.

**Parameters:**

- `chainId` (required, string): CAIP-2 chain ID. Examples: `"solana:mainnet"`, `"eip155:1"` (Ethereum), `"eip155:8453"` (Base), `"eip155:137"` (Polygon), `"eip155:42161"` (Arbitrum), `"sui:mainnet"`, `"bip122:000000000019d6689c085ae165831e93"` (Bitcoin)
- `type` (required, string): `"transaction"` or `"message"`
- `params` (required, object): Chain-specific transaction parameters:
  - **Solana**: `{ "transactions": ["<base58_tx>"], "method"?: "signAndSendTransaction", "simulatorConfig"?: { "decodeAccounts"?: true, "decodeInstructions"?: true } }`
  - **EVM**: `{ "transactions": [{ "from": "0x...", "to": "0x...", "value": "0x...", "data": "0x...", "chainId": "0x1", "type": "0x2" }] }`
  - **Sui**: `{ "rawTransaction": "<raw_bytes>" }`
  - **Bitcoin**: `{ "transaction": "<raw_tx>", "userAddresses"?: ["bc1q..."] }`
  - **EVM message**: `{ "message": "0x..." }`
- `url` (optional, string): dApp origin URL (e.g. `"https://jup.ag"`)
- `context` (optional, string): `"swap"` | `"bridge"` | `"send"` | `"gaslessSwap"`
- `userAccount` (optional, string): Wallet address for the simulation. Auto-derived from the authenticated session for Solana and EVM; supply explicitly for Sui and Bitcoin if needed.
- `language` (optional, string): Response language code (default: `"en"`). Supports `"es"`, `"ja"`, and others.
- `derivationIndex` (optional, number): HD derivation index for address lookup (default: `0`)
- `walletId` (optional, string): Override the wallet ID (defaults to the authenticated wallet)

---

### Perpetuals Tools (Hyperliquid)

The MCP server includes 12 tools for perpetuals trading on Hyperliquid via Phantom's backend. For full parameter reference, examples, and the typical agent workflow see **[PERPS.md](./PERPS.md)**.

#### Read-only

| Tool                     | Description                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `get_perp_account`       | Perp account balance: `accountValue`, `availableBalance`, `availableToTrade`              |
| `get_perp_markets`       | All markets with price, funding rate, open interest, 24h volume, max leverage             |
| `get_perp_positions`     | Open positions: direction, size, entry price, leverage, unrealized PnL, liquidation price |
| `get_perp_orders`        | Open limit/TP/SL orders with ID, price, size, reduce-only flag                            |
| `get_perp_trade_history` | Historical fills with fee and closed PnL                                                  |

#### Write

| Tool                     | Description                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `deposit_to_hyperliquid` | Full bridge flow from Solana/EVM → Hypercore spot → perp (handles transfer, bridging, spot sell, and deposit) |
| `open_perp_position`     | Market or limit long/short; `sizeUsd` is the notional value                                                   |
| `close_perp_position`    | Market close, full or partial (`sizePercent`, default 100%)                                                   |
| `cancel_perp_order`      | Cancel by `orderId` (get IDs from `get_perp_orders`)                                                          |
| `update_perp_leverage`   | Set leverage and margin type (`isolated` or `cross`)                                                          |
| `transfer_spot_to_perps` | Move USDC within Hypercore: spot → perp                                                                       |
| `withdraw_from_perps`    | Move USDC within Hypercore: perp → spot                                                                       |

> **Note:** The perps write tools (`open_perp_position`, `close_perp_position`, `cancel_perp_order`, `update_perp_leverage`, `transfer_spot_to_perps`, `withdraw_from_perps`) sign Hyperliquid typed actions using the wallet's EVM key via EIP-712 (`chainId: 42161`). Accounts are identified by their EVM address on Hypercore. `deposit_to_hyperliquid` is different — it routes through the Phantom cross-chain swapper and does not use EIP-712.

---

## Configuration

### Environment Variables

The MCP server supports the following environment variables:

#### Debug Logging

Enable debug logging to see detailed execution traces:

- `PHANTOM_MCP_DEBUG=1` - Enable debug logging

Debug logs are written to stderr and appear in Claude Desktop's MCP server logs.

### Session Storage

Sessions are stored in `~/.phantom-mcp/session.json` with the following security measures:

- Directory permissions: `0o700` (rwx for user only)
- File permissions: `0o600` (rw for user only)
- Contains: Wallet ID, organization ID, stamper keys, user authentication details

**Session persistence:**

- Sessions are stored locally in `~/.phantom-mcp/session.json`
- If the server rejects the session (401/403), the MCP server automatically triggers re-authentication and retries the tool call
- Sessions persist until explicitly deleted or revoked server-side

**To reset your session:**

1. Delete the session file:
   ```bash
   rm ~/.phantom-mcp/session.json
   ```
2. Restart Claude Desktop (the server will re-authenticate on next use)

## Security

### Authentication Security

- Device-code authentication is the default flow
- Session ID validation prevents replay attacks where applicable

### Session Security

- Session files have restrictive Unix permissions (user-only read/write)
- Tokens are encrypted in transit (HTTPS)
- No plaintext credentials are stored

### Network Security

- All API requests use HTTPS
- Request signing with API key stamper prevents tampering
- Session tokens are bearer tokens with limited scope

## Troubleshooting

### Browser Doesn't Open

**Problem:** The authentication flow tries to open your browser but fails.

**Solutions:**

- Ensure you have a default browser configured
- Manually visit the URL shown in the logs
- Check if the `open` command works in your terminal: `open https://phantom.app`

### Session Not Persisting

**Problem:** The server asks you to authenticate every time.

**Solutions:**

- Check session file exists: `ls -la ~/.phantom-mcp/session.json`
- Verify file permissions: `chmod 600 ~/.phantom-mcp/session.json`
- Check logs for session expiry messages
- Ensure `~/.phantom-mcp` directory has correct permissions: `chmod 700 ~/.phantom-mcp`

### MCP Server Not Loading in Claude

**Problem:** Claude Desktop doesn't show the Phantom tools.

**Solutions:**

1. Verify config file syntax is valid JSON
2. Check Claude Desktop logs:
   - macOS: `~/Library/Logs/Claude/`
   - Windows: `%APPDATA%/Claude/logs/`
3. Restart Claude Desktop after config changes
4. Test the server manually with MCP inspector (see Manual Testing section)

### Authentication Timeout

**Problem:** Authentication flow times out before you complete it.

**Solutions:**

- Complete the browser approval flow promptly
- Complete the authentication flow promptly
- If timeout occurs, restart Claude Desktop to retry

### Invalid Session Error

**Problem:** Session exists but is rejected by API.

**Solutions:**

- Delete session file: `rm ~/.phantom-mcp/session.json`
- Restart Claude Desktop
- Re-authenticate when prompted

## Development

### Prerequisites

- Node.js 18+ and yarn
- TypeScript 5+

### Building

```bash
# Install dependencies
yarn install

# Build the project
yarn build

# Watch mode for development
yarn dev
```

### Testing

```bash
# Run all tests
yarn test

# Watch mode
yarn test:watch

# Check types
yarn check-types
```

### Linting

```bash
# Run ESLint
yarn lint

# Format code with Prettier
yarn prettier
```

### Running Locally

You can test the MCP server locally before installing:

```bash
# Build first
yarn build

# Run directly
node dist/cli.js
```

## Contributing

This package is part of the [Phantom Connect SDK](https://github.com/phantom/phantom-connect-sdk) monorepo. Please refer to the main repository for contribution guidelines.

### Environment Variables Reference

All environment variables recognized by the MCP server, grouped by purpose:

#### Auth / URLs

| Variable                       | Default                              | Description                                                                   |
| ------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------- |
| `PHANTOM_AUTH_BASE_URL`        | `https://auth.phantom.app`           | Base URL for the Phantom auth service (token exchange, DCR).                  |
| `PHANTOM_CONNECT_BASE_URL`     | `https://connect.phantom.app`        | Base URL for Phantom Connect and browser-based authentication pages.          |
| `PHANTOM_WALLETS_API_BASE_URL` | `https://api.phantom.app/v1/wallets` | Base URL for the Phantom wallets/KMS API used by `PhantomClient` for signing. |

#### API

| Variable               | Default                   | Description                                           |
| ---------------------- | ------------------------- | ----------------------------------------------------- |
| `PHANTOM_API_BASE_URL` | `https://api.phantom.app` | Base URL for the Phantom API.                         |
| `PHANTOM_VERSION`      | `mcp-server`              | Value sent as the `X-Phantom-Version` request header. |

#### Logging / debugging

| Variable              | Default | Description                                                                                                                                    |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PHANTOM_MCP_DEBUG`   | —       | Set to `1` or `true` to enable `DEBUG`-level log lines on stderr.                                                                              |
| `DEBUG`               | —       | Also enables debug logging (same effect as `PHANTOM_MCP_DEBUG`).                                                                               |
| `ENABLE_FILE_LOGGING` | —       | Set to `true` to write all log lines to `/tmp/phantom-mcp-debug.log` (async, non-blocking). Disabled by default to avoid unnecessary disk I/O. |

## License

See the main repository [LICENSE](../../LICENSE) file.

## Privacy Policy

The Phantom MCP Server connects to Phantom's embedded wallet infrastructure. Here is what data is involved:

**Data collected and transmitted:**

- OAuth authentication tokens (exchanged with `connect.phantom.app` during login)
- Wallet identifiers and blockchain addresses (retrieved from Phantom's API)
- Transaction and message signing requests (sent to Phantom's API for signing)
- Swap quote requests (sent to `api.phantom.app` when using `buy_token`)

**Local storage:**

- Session data is stored in `~/.phantom-mcp/session.json` with user-only permissions (`0600`). This file contains your wallet ID, organization ID, and stamper keypair. It is never transmitted to any third party.

**No data sold or shared:** Phantom does not sell your personal data. Data transmitted to Phantom's API is governed by [Phantom's Privacy Policy](https://phantom.com/privacy).

**Retention:** Session files persist locally until you delete them. Phantom's server-side data retention is governed by Phantom's Privacy Policy.

**Third-party services:** When using `buy_token`, swap quotes are fetched from `api.phantom.app`. No data is sent to Jupiter or other third-party aggregators directly by this server.

For questions, contact [support@phantom.com](mailto:support@phantom.com) or visit [phantom.com/privacy](https://phantom.com/privacy).

## Support

- [Phantom Documentation](https://docs.phantom.com)
- [GitHub Issues](https://github.com/phantom/phantom-connect-sdk/issues)

## Related Packages

- [@phantom/server-sdk](../server-sdk) - Server-side SDK for Phantom integration
- [@phantom/client](../client) - Client library for Phantom API
- [@phantom/react-sdk](../react-sdk) - React SDK for browser applications
