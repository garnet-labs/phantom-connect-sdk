# Phantom OpenClaw Plugin

Direct integration with Phantom wallet for OpenClaw agents. This plugin wraps the Phantom MCP Server to provide seamless wallet operations including address retrieval, message signing, transaction signing, token transfers, and token swaps.

## Overview

The Phantom OpenClaw Plugin provides native integration with Phantom wallet functionality. Instead of being a generic MCP bridge, it directly integrates the Phantom MCP Server tools as OpenClaw tools, providing a seamless experience for AI agents.

## Features

- **Direct Integration**: Built on top of `@phantom/mcp-server` for reliable wallet operations
- **Automatic Authentication**: Handles OAuth flow and session management automatically
- **Type-Safe**: Full TypeScript support with proper type definitions
- **Simple Setup**: Minimal configuration - just enable the plugin and use

## Prerequisites

Before using this plugin, you **must** obtain an App ID from the Phantom Portal:

1. **Visit the Phantom Portal**: Go to [phantom.com/portal](https://phantom.com/portal)
2. **Sign in**: Use your Gmail or Apple account to sign in
3. **Create an App**: Click "Create App" and fill in the required details
4. **Get Your App ID**: Navigate to the "Phantom Connect" tab to find your App ID
   - Your app is automatically approved for development use
   - Copy the App ID for the configuration below

**Important:** The email you use to sign in to the Phantom Portal **must match** the email you use when authenticating with the plugin. If these don't match, authentication will fail.

## Installation

```bash
openclaw plugins install @phantom/openclaw-plugin
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

## Available Tools

The plugin exposes the following tools from the Phantom MCP Server:

### `get_wallet_addresses`

Retrieve wallet addresses for all supported blockchain chains.

**Parameters:**

- `derivationIndex` (number, optional): Derivation index for the wallet (default: 0)

**Example:**

```json
{
  "derivationIndex": 0
}
```

### `sign_message`

Sign an arbitrary message with the Phantom wallet.

**Parameters:**

- `message` (string, required): The message to sign
- `derivationIndex` (number, optional): Derivation index for the wallet (default: 0)

**Example:**

```json
{
  "message": "Hello, Phantom!",
  "derivationIndex": 0
}
```

### `sign_transaction`

Sign a blockchain transaction.

**Parameters:**

- `transaction` (string, required): Base64-encoded transaction data
- `derivationIndex` (number, optional): Derivation index for the wallet (default: 0)
- `chain` (string, optional): Blockchain chain identifier

**Example:**

```json
{
  "transaction": "base64-encoded-transaction-data",
  "derivationIndex": 0,
  "chain": "solana"
}
```

### `transfer_tokens`

Transfer SOL or SPL tokens on Solana. Builds, signs, and sends the transaction immediately.

**Parameters:**

- `networkId` (string, required): Solana network identifier (e.g., "solana:mainnet", "solana:devnet")
- `to` (string, required): Recipient Solana address
- `amount` (string, required): Transfer amount (e.g., "0.1" or "1000000")
- `amountUnit` (string, optional): Unit type - `"ui"` for human-readable (SOL/token units) or `"base"` for atomic units (lamports). Default: `"ui"`
- `tokenMint` (string, optional): SPL token mint address. Omit for SOL transfers
- `decimals` (number, optional): Token decimals (optional for SPL tokens)
- `derivationIndex` (number, optional): Derivation index for the wallet (default: 0)
- `createAssociatedTokenAccount` (boolean, optional): Create destination ATA if missing (default: true)

**Example (SOL Transfer):**

```json
{
  "networkId": "solana:mainnet",
  "to": "H8FpYTgx4Uy9aF9Nk9fCTqKKFLYQ9KfC6UJhMkMDzCBh",
  "amount": "0.1",
  "amountUnit": "ui"
}
```

**Example (SPL Token Transfer):**

```json
{
  "networkId": "solana:devnet",
  "to": "H8FpYTgx4Uy9aF9Nk9fCTqKKFLYQ9KfC6UJhMkMDzCBh",
  "tokenMint": "So11111111111111111111111111111111111111112",
  "amount": "1.5",
  "amountUnit": "ui"
}
```

**⚠️ Warning:** This tool submits transactions immediately and irreversibly.

### `buy_token`

Fetch a Solana swap quote from Phantom's quotes API. Optionally execute the swap immediately.

**Parameters:**

- `networkId` (string, optional): Solana network identifier (default: "solana:mainnet")
- `sellTokenIsNative` (boolean, optional): Set true to sell native SOL (default: true if sellTokenMint not provided)
- `sellTokenMint` (string, optional): Mint address of the token to sell (omit if selling native SOL)
- `buyTokenIsNative` (boolean, optional): Set true to buy native SOL (default: false)
- `buyTokenMint` (string, optional): Mint address of the token to buy (omit if buying native SOL)
- `amount` (string, required): Sell amount (e.g., "0.5" or "500000000")
- `amountUnit` (string, optional): Unit type - `"ui"` for token units or `"base"` for atomic units. Default: `"base"`
- `slippageTolerance` (number, optional): Slippage tolerance in percent (0-100)
- `execute` (boolean, optional): If true, signs and sends the transaction immediately. Default: false
- `derivationIndex` (number, optional): Derivation index for the wallet (default: 0)

**Example:**

```json
{
  "networkId": "solana:mainnet",
  "sellTokenIsNative": true,
  "buyTokenMint": "So11111111111111111111111111111111111111112",
  "amount": "0.5",
  "amountUnit": "ui",
  "slippageTolerance": 1,
  "execute": true
}
```

**⚠️ Warning:** When `execute: true`, this tool submits transactions immediately and irreversibly.

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
   yarn workspace @phantom/openclaw-plugin build
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
