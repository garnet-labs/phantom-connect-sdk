# @phantom/mcp-server

> **⚠️ PREVIEW DISCLAIMER**
>
> This MCP server is currently in **preview** and may break or change at any time without notice.
>
> **Always use a separate Phantom account specifically for testing with AI agents. These accounts should not contain significant assets.**
>
> **Phantom makes no guarantees whatsoever around anything your agent may do using this MCP server.** Use at your own risk.

An MCP (Model Context Protocol) server that provides LLMs like Claude with direct access to Phantom wallet operations. This enables AI assistants to interact with embedded wallets, view addresses, sign and send transactions, and sign messages across Solana and EVM chains through natural language interactions.

## Features

- **SSO Authentication**: Seamless integration with Phantom's embedded wallet SSO flow (Google/Apple login)
- **Session Persistence**: Automatic session management with stamper keys stored in `~/.phantom-mcp/session.json`
- **Auto Re-authentication**: On session expiry (401/403), the server automatically triggers re-auth and retries the tool call
- **Multi-Chain Support**: Solana and EVM chains (Ethereum, Base, Polygon, Arbitrum, and more)
- **Chain-Specific Tools** (mirrors the browser-sdk API pattern):
  - `get_connection_status` - Lightweight local check of wallet connection state (no API call)
  - `get_wallet_addresses` - Get Solana, Ethereum, Bitcoin, and Sui addresses for the authenticated wallet
  - `get_token_balances` - Get all fungible token balances with live USD prices
  - `send_solana_transaction` - Sign and broadcast a pre-built Solana transaction
  - `send_evm_transaction` - Sign and broadcast an EVM transaction (auto-fills nonce, gas, gasPrice)
  - `sign_solana_message` - Sign a UTF-8 message on Solana
  - `sign_evm_personal_message` - Sign a UTF-8 message via EIP-191 personal_sign on any EVM network
  - `sign_evm_typed_data` - Sign EIP-712 typed structured data (DeFi permits, order signing)
  - `transfer_tokens` - Transfer native tokens or fungible tokens on Solana and EVM chains (builds, signs, and sends)
  - `buy_token` - Fetch a swap quote from Phantom's routing engine for Solana, EVM, and cross-chain swaps (optionally executes)

## Installation

### Option 1: npx (Recommended)

Use npx to run the server without global installation. This ensures you always use the latest version:

```bash
npx -y @phantom/mcp-server
```

### Option 2: Global Install

Install the package globally for faster startup:

```bash
npm install -g @phantom/mcp-server
```

Then run:

```bash
phantom-mcp
```

## Getting Your App ID

**Important:** Before you can use the MCP server, you must obtain an App ID from the Phantom Portal. This is required for the early release.

### Steps to Get Your App ID:

1. **Visit the Phantom Portal**: Go to [phantom.com/portal](https://phantom.com/portal)
2. **Sign in**: Use your Gmail or Apple account to sign in
3. **Create an App**: Click "Create App" and fill in the required details
4. **Configure Redirect URL**:
   - Navigate to Dashboard → View App → Redirect URLs
   - Add `http://localhost:8080/callback` as a redirect URL
   - This allows the OAuth callback to work correctly
5. **Get Your App ID**: Navigate to the "Phantom Connect" tab to find your App ID
   - Your app is automatically approved for development use
   - Copy the App ID for use in the MCP server configuration

**Important Note:** The email you use to sign in to the Phantom Portal **must match** the email you use when authenticating in the MCP server. If these don't match, authentication will fail.

Once you have your App ID, you can proceed with the configuration below.

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
      "args": ["-y", "@phantom/mcp-server"],
      "env": {
        "PHANTOM_APP_ID": "your_app_id_from_portal"
      }
    }
  }
}
```

**Using global install:**

```json
{
  "mcpServers": {
    "phantom": {
      "command": "phantom-mcp",
      "env": {
        "PHANTOM_APP_ID": "your_app_id_from_portal"
      }
    }
  }
}
```

After updating the config, restart Claude Desktop to load the server.

### Environment Variables

Configure the server behavior using environment variables:

**App ID / OAuth Client Credentials:**

```bash
PHANTOM_APP_ID=your_app_id                    # Required (App ID from Phantom Portal)
# OR
PHANTOM_CLIENT_ID=your_client_id              # Alternative to PHANTOM_APP_ID

PHANTOM_CLIENT_SECRET=your_client_secret      # Optional (for confidential clients)
```

**Client Types:**

- **Public client** (recommended): Provide only `PHANTOM_APP_ID` (or `PHANTOM_CLIENT_ID`). Uses PKCE for security, similar to browser SDK.
- **Confidential client**: Provide both `PHANTOM_APP_ID` and `PHANTOM_CLIENT_SECRET`. Uses HTTP Basic Auth + PKCE.

**Note:** You must obtain your App ID from the [Phantom Portal](https://phantom.com/portal) before using the MCP server. See the "Getting Your App ID" section above for detailed instructions. Both `PHANTOM_APP_ID` and `PHANTOM_CLIENT_ID` are supported for backwards compatibility.

**Advanced Configuration (Optional):**

Most users won't need to change these settings. Available options:

- `PHANTOM_CALLBACK_PORT` - OAuth callback port (default: `8080`)
- `PHANTOM_CALLBACK_PATH` - OAuth callback path (default: `/callback`)
- `PHANTOM_MCP_DEBUG` - Enable debug logging (set to `1`)

**In Claude Desktop:**

```json
{
  "mcpServers": {
    "phantom": {
      "command": "npx",
      "args": ["-y", "@phantom/mcp-server"],
      "env": {
        "PHANTOM_APP_ID": "your_app_id_from_portal",
        "PHANTOM_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

### Authentication Flow

On first run, the server will:

1. **App ID**: Use App ID from `PHANTOM_APP_ID` (or `PHANTOM_CLIENT_ID`) environment variable
2. **Browser Authentication**: Open your default browser to `https://connect.phantom.app` for Google/Apple login
   - **Important**: Use the same email address that you used to sign in to the Phantom Portal
3. **SSO Callback**: Start a local server on port 8080 to receive the SSO callback
4. **Session Storage**: Save your session (including wallet ID, organization ID, and stamper keys) to `~/.phantom-mcp/session.json`

The session file is secured with restrictive permissions (0o600) and contains:

- Wallet and organization identifiers
- Stamper keypair (public key registered with auth server, secret key for signing API requests)
- User authentication details

Sessions use stamper keys which don't expire. The embedded wallet is created during SSO authentication and persists across sessions.

### Manual Testing

Test the server directly using the MCP inspector:

```bash
npx @modelcontextprotocol/inspector npx -y @phantom/mcp-server
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

> **Execution Warning**
> `send_solana_transaction`, `send_evm_transaction`, `transfer_tokens`, and `buy_token` (when `execute: true`) all submit transactions immediately and irreversibly. Always verify parameters before calling these tools.

---

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

Mirrors `sdk.solana.signAndSendTransaction(tx)` from the browser-sdk.

**Parameters:**

- `transaction` (required, string): Base64-encoded serialized Solana transaction (standard Solana JSON-RPC format — not base58)
- `networkId` (optional, string): Solana network (e.g., `"solana:mainnet"`, `"solana:devnet"`). Defaults to `"solana:mainnet"`.
- `walletId` (optional, string): Wallet ID to use (defaults to authenticated wallet)
- `derivationIndex` (optional, number): Derivation index (default: 0)

**Example:**

```json
{
  "transaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQABAgME..."
}
```

**Response:**

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

**Example — plain ETH transfer (nonce, gas, and gasPrice auto-fetched):**

```json
{
  "chainId": 1,
  "to": "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
  "value": "0x38D7EA4C68000"
}
```

**Example — EIP-1559 transaction on Base:**

```json
{
  "chainId": 8453,
  "to": "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E",
  "value": "0xDE0B6B3A7640000",
  "maxFeePerGas": "0x6FC23AC00",
  "maxPriorityFeePerGas": "0x77359400"
}
```

**Example — contract call with explicit gas (e.g. from a LI.FI quote):**

```json
{
  "chainId": 1,
  "to": "0xContractAddress",
  "data": "0xa9059cbb000000000000000000000000...",
  "gas": "0x186A0",
  "gasPrice": "0x4A817C800"
}
```

**Response:**

```json
{
  "hash": "0xabc123...",
  "networkId": "eip155:1",
  "from": "0x8d8b06e017944f5951418b1182d119a376efb39d",
  "to": "0x742d35Cc6634C0532925a3b8D4C8db86fB5C4A7E"
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

### 9. transfer_tokens

Transfers native tokens or fungible tokens on Solana and EVM chains. Builds, signs, and sends the transaction immediately.

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

**Response:**

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

---

### 10. buy_token

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

- Sessions use stamper keypair authentication stored locally in `~/.phantom-mcp/session.json`
- Stamper public key is registered with the auth server during SSO
- Stamper secret key is used to sign all API requests
- If the server rejects the session (401/403), the MCP server automatically triggers re-authentication and retries the tool call
- Sessions persist until explicitly deleted or revoked server-side

**To reset your session:**

1. Delete the session file:
   ```bash
   rm ~/.phantom-mcp/session.json
   ```
2. Restart Claude Desktop (the server will re-authenticate on next use)

## Security

### OAuth Flow Security

- Uses PKCE (Proof Key for Code Exchange) for secure OAuth authentication
- App IDs are pre-registered through the Phantom Portal
- Session ID validation prevents replay attacks
- Callback server uses ephemeral localhost binding

### Session Security

- Session files have restrictive Unix permissions (user-only read/write)
- API keys are generated using cryptographically secure random sources
- Tokens are encrypted in transit (HTTPS)
- No plaintext credentials are stored

### Network Security

- All API requests use HTTPS
- Request signing with API key stamper prevents tampering
- Session tokens are bearer tokens with limited scope

## Troubleshooting

### Browser Doesn't Open

**Problem:** The OAuth flow tries to open your browser but fails.

**Solutions:**

- Ensure you have a default browser configured
- Manually visit the URL shown in the logs
- Check if the `open` command works in your terminal: `open https://phantom.app`

### Port 8080 Already in Use

**Problem:** Cannot bind OAuth callback server to port 8080.

**Error:** `EADDRINUSE: address already in use :::8080`

**Solutions:**

- Stop the process using port 8080: `lsof -ti:8080 | xargs kill`
- Change the callback port: Set `PHANTOM_CALLBACK_PORT` environment variable to a different port

### Authentication Email Mismatch

**Problem:** Authentication fails or you can't access your wallet.

**Solution:** Ensure you're using the **same email address** for both:

- Signing in to the Phantom Portal (where you created your app)
- Authenticating in the MCP server (Google/Apple login)

If the emails don't match, authentication will fail.

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

- The OAuth callback server waits 5 minutes by default
- Complete the authentication flow promptly
- If timeout occurs, restart Claude Desktop to retry

### Invalid Session Error

**Problem:** Session exists but is rejected by API.

**Solutions:**

- Verify your App ID is correct (check the Phantom Portal)
- Ensure the email used for authentication matches the Portal email
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

#### Authentication (required)

| Variable                | Default | Description                                                                                               |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `PHANTOM_APP_ID`        | —       | App ID from the [Phantom Portal](https://phantom.com/portal). Required unless `PHANTOM_CLIENT_ID` is set. |
| `PHANTOM_CLIENT_ID`     | —       | Alias for `PHANTOM_APP_ID` (backwards compatibility).                                                     |
| `PHANTOM_CLIENT_SECRET` | —       | Client secret for confidential OAuth clients. Omit for public clients (PKCE-only).                        |

#### OAuth / Auth URLs

| Variable                   | Default                              | Description                                                   |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `PHANTOM_AUTH_BASE_URL`    | `https://auth.phantom.app`           | Base URL for the Phantom auth service (token exchange, DCR).  |
| `PHANTOM_CONNECT_BASE_URL` | `https://connect.phantom.app`        | Base URL for the Phantom Connect SSO page (browser redirect). |
| `PHANTOM_API_BASE_URL`     | `https://api.phantom.app/v1/wallets` | Base URL for the Phantom wallet API.                          |
| `PHANTOM_CALLBACK_PORT`    | `8080`                               | Local port for the OAuth redirect callback server.            |
| `PHANTOM_CALLBACK_PATH`    | `/callback`                          | Path for the OAuth redirect callback.                         |
| `PHANTOM_SSO_PROVIDER`     | `google`                             | Default SSO provider (`google` or `apple`).                   |

#### API / swap

| Variable                 | Default                                  | Description                                                               |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------- |
| `PHANTOM_QUOTES_API_URL` | `https://api.phantom.app/swap/v2/quotes` | Override the swap quotes API endpoint used by `buy_token`. Must be HTTPS. |
| `PHANTOM_VERSION`        | `mcp-server`                             | Value sent as the `X-Phantom-Version` request header.                     |

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
