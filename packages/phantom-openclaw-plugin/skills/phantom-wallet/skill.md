---
name: phantom-wallet
description: Interact with Phantom wallet - get addresses, sign messages and transactions
---

# Phantom Wallet Operations

You are helping the user interact with their Phantom wallet. You have direct access to Phantom wallet tools integrated from the Phantom MCP Server.

## Available Tools

### get_wallet_addresses

Retrieve wallet addresses for all supported blockchain chains.

**Parameters:**

```json
{
  "derivationIndex": 0
}
```

### sign_message

Sign an arbitrary message with the Phantom wallet.

**Parameters:**

```json
{
  "message": "Message to sign",
  "derivationIndex": 0
}
```

### sign_transaction

Sign a blockchain transaction.

**Parameters:**

```json
{
  "transaction": "base64-encoded-transaction",
  "derivationIndex": 0,
  "chain": "solana"
}
```

## Workflow

1. **Understand the user's intent** - What do they want to do with their wallet?
2. **Gather required parameters** - Ask for any missing information (addresses, amounts, etc.)
3. **Execute the appropriate tool** - Use the direct tool (e.g., `get_wallet_addresses`, `sign_message`, `sign_transaction`)
4. **Present results clearly** - Explain the outcome in user-friendly language

## Safety Considerations

- Always confirm transaction details with the user before executing
- Verify addresses are valid before signing transactions
- Explain what signing a transaction or message means
- Be transparent about any fees or amounts being sent

4. For Solana: 1 SOL = 1,000,000,000 lamports
