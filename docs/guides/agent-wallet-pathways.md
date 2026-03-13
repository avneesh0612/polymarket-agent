# AI Agent Wallet Pathways

This guide explains the two ways to give an AI agent access to a wallet in this repo, when to use each, and how to implement them.

---

## Overview

There are two pathways for granting a LangGraph agent wallet access via Dynamic's MPC delegation:

1. **Server Wallet (Direct)** — Credentials are loaded once from environment variables at startup. Best for CLI agents and single-user tools.
2. **Delegated Access (Multi-user)** — Each user approves delegation in the app. Credentials are delivered per-user via webhook and stored in Postgres. Best for production APIs serving multiple users.

| Feature | Server Wallet (Direct) | Delegated Access |
|---|---|---|
| Users | Single (developer) | Multi-user |
| Credential storage | Environment variables | Postgres per-user |
| Setup complexity | Low | Medium |
| Best for | CLI tools, dev/testing | Production APIs, mobile apps |
| Credential lifecycle | Set once at startup | Per user, webhook-updated |

---

## How MPC Delegation Works

Dynamic uses **MPC (multi-party computation)** to eliminate single points of failure for private keys. The user's private key is mathematically split into two shares — your server never sees the full key.

When a user approves delegation in the app:

1. Their key share is re-encrypted with **your server's RSA public key**.
2. Dynamic sends the encrypted share (plus other credentials) to your server via a signed webhook.
3. Your server decrypts the share using its RSA private key.
4. At signing time, your server provides its share to Dynamic's API. Dynamic combines both shares using MPC to produce the signature — **neither party alone can sign**.

This means compromising your server does not expose the user's full private key.

---

## Pathway 1: Server Wallet (Direct)

### When to Use

- CLI agents running as a single developer
- Local development and testing
- Single-user automation scripts

This pathway loads credentials once at startup and stores them as a module-level singleton. Every signing call in the session uses the same wallet.

### Step 1: Get Credentials from the Dynamic Dashboard

In your Dynamic dashboard, navigate to the wallet you want to delegate, and retrieve:

- **Wallet ID** — the UUID identifying the wallet
- **Wallet Address** — the EVM address (`0x...`)
- **API Key** — used to authenticate signing requests
- **Key Share** — your server's share of the MPC key (a JSON object)

### Step 2: Configure Environment Variables

There are two sub-modes depending on whether you have already decrypted the key share.

#### Mode A: Pre-decrypted (recommended for development)

Paste the credentials directly. No RSA key required.

```env
DELEGATED_WALLET_ID=<wallet-uuid>
DELEGATED_WALLET_ADDRESS=0x...
DELEGATED_WALLET_API_KEY=<api-key>
DELEGATED_KEY_SHARE={"key":"..."}   # JSON string
```

#### Mode B: Encrypted (decrypt at startup)

Use this when you have the raw webhook payload and want to paste it directly without pre-decrypting. The agent decrypts on startup using your RSA private key.

```env
DELEGATION_KEY=<RSA private key PEM>
DELEGATED_WALLET_ID=<wallet-uuid>
DELEGATED_WALLET_ADDRESS=0x...
ENCRYPTED_WALLET_API_KEY={"iv":"...","data":"..."}   # JSON from webhook
ENCRYPTED_KEY_SHARE={"iv":"...","data":"..."}        # JSON from webhook
```

### Step 3: Load Credentials in Your Agent

`loadDelegationCredentials()` in `agent/clients/delegated-wallet.ts` handles both modes automatically. If `DELEGATED_KEY_SHARE` is set it uses Mode A; if `ENCRYPTED_KEY_SHARE` is set it decrypts using `DELEGATION_KEY`.

The CLI agent creates a singleton at module load time:

```typescript
const creds = loadDelegationCredentials();
```

All signing calls in that process use `creds`.

### Step 4: Sign Something

```typescript
import { loadDelegationCredentials, signMessageDelegated } from "./clients/delegated-wallet";

const creds = loadDelegationCredentials();
const signature = await signMessageDelegated(creds, "Hello from agent");
console.log("Signature:", signature);
```

---

## Pathway 2: Delegated Access (Multi-user)

### When to Use

- Backend APIs serving multiple users
- Mobile or web apps where each user has their own wallet
- Production deployments requiring per-user credential isolation

Each user has their own delegation record in Postgres. Credentials are never shared across users. The agent is instantiated per request with the requesting user's credentials.

### Step 1: User Authenticates with Dynamic

The user signs in with Dynamic in the mobile or web app. They receive a **JWT** that identifies them (`user.sub` is the user ID). This JWT is sent to your backend on each API request.

### Step 2: User Approves Delegation in the App

Using the Dynamic SDK on the client side, the user calls the delegation approval flow. This records their consent and triggers Dynamic to prepare the encrypted credential payload.

### Step 3: Dynamic Fires the `wallet.delegation.created` Webhook

Dynamic sends a `POST` request to your configured webhook endpoint with:

- The encrypted API key (`encryptedApiKey`)
- The encrypted key share (`encryptedKeyShare`)
- The wallet ID and address
- An HMAC signature for verification

### Step 4: Server Verifies and Stores the Credentials

Your webhook handler:

1. Verifies the HMAC signature using your Dynamic webhook secret.
2. Decrypts the API key and key share using your RSA private key.
3. Stores the decrypted credentials in Postgres, keyed by user ID.

The `backend/` package handles all of this. The stored record contains `walletId`, `walletAddress`, `apiKey`, and `keyShare` as JSONB.

### Step 5: Fetch Credentials on Each API Request

When the user calls your agent API, look up their delegation record:

```typescript
const record = await getDelegation(user.sub);
if (!record) {
  return c.json(
    { error: "No delegation found. Please grant wallet access first." },
    403
  );
}
```

### Step 6: Run the Agent with the User's Credentials

Build the credentials object from the stored record and pass it to the agent:

```typescript
const creds: DelegationCredentials = {
  walletId: record.walletId,
  walletAddress: record.walletAddress,
  apiKey: record.apiKey,
  keyShare: record.keyShare,
};

const response = await runAgentForUser(message, threadId, creds, jwt);
```

From `backend/src/routes/agent.ts`:

```typescript
const record = await getDelegation(user.sub);
if (!record) return c.json({ error: "No delegation found. Please grant wallet access first." }, 403);
const creds: DelegationCredentials = { walletId: record.walletId, ... };
const response = await runAgentForUser(message, threadId, creds, jwt);
```

Because credentials are fetched and passed per-request, each user's agent session is fully isolated.

---

## Signing Operations

Both pathways use the same set of signing functions from `agent/clients/delegated-wallet.ts`. All functions accept a `DelegationCredentials` object as the first argument.

The `DelegatedEvmWalletClient` from `@dynamic-labs-wallet/node-evm` handles the MPC signing interaction with Dynamic's API under the hood.

### `signMessageDelegated`

Signs an arbitrary message using EIP-191 (`personal_sign`). Use this for authentication challenges, off-chain attestations, or any text message.

```typescript
const signature = await signMessageDelegated(creds, "Authenticate me");
// Returns: "0x..."
```

### `signTypedDataDelegated`

Signs structured typed data using EIP-712. Required for Polymarket order placement and many DeFi protocols that use `signTypedData`.

```typescript
const typedData = {
  domain: { name: "MyApp", version: "1", chainId: 137 },
  types: { Order: [{ name: "amount", type: "uint256" }] },
  message: { amount: "1000000" },
};
const signature = await signTypedDataDelegated(creds, typedData);
// Returns: "0x..."
```

### `signTransactionOnlyDelegated`

Signs a transaction and returns the signed bytes without broadcasting it to the network. Use this when you want to construct, sign, and broadcast separately, or when you need the raw signed transaction for other purposes.

```typescript
const signedTx = await signTransactionOnlyDelegated(creds, {
  to: "0xRecipient",
  value: "1000000000000000", // wei
  chainId: 137,
});
// Returns: "0x..." (RLP-encoded signed transaction)
```

### `sendTransactionDelegated`

Signs and broadcasts an EIP-1559 transaction in one call. Handles:

- **Auto gas estimation** with a 20% buffer
- **EIP-1559** fee fields (`maxFeePerGas`, `maxPriorityFeePerGas`)
- **Nonce management** (fetches current nonce automatically)

```typescript
const txHash = await sendTransactionDelegated(
  creds,
  137,           // chainId (Polygon)
  "0xRecipient", // to
  "0x",          // data (empty for plain transfer)
  "1000000"      // value in wei
);
// Returns: "0x..." (transaction hash)
```

---

## Supported Chains

The following chains are supported for transaction signing and broadcasting:

| Chain ID | Network |
|---|---|
| 1 | Ethereum Mainnet |
| 137 | Polygon |
| 8453 | Base |
| 10 | Optimism |
| 42161 | Arbitrum |
| 56 | BSC |
| 43114 | Avalanche |

Pass the chain ID as the `chainId` argument to `sendTransactionDelegated`.

---

## Security Considerations

### Credential Isolation (Multi-user)

In the backend, credentials are fetched from Postgres on each request and passed explicitly to the agent — they are never stored as module-level singletons. This ensures that one user's credentials cannot leak into another user's request context.

> **Note:** The codebase includes a comment about concurrency: because each request independently fetches and passes credentials, there is no shared mutable state between concurrent agent sessions. Each in-flight request holds its own `creds` reference on the call stack.

### Key Share Sensitivity

The `key_share` JSON object is the most sensitive value in the system — it is your server's half of the user's private key. Handle it accordingly:

- It is transmitted encrypted (from Dynamic's webhook) and should only be decrypted in memory.
- In Postgres it is stored as JSONB. Ensure your database is access-controlled and encrypted at rest.
- Never log the key share value.
- Never expose it in API responses.

### Revocation

When a user revokes delegation (by calling `revokeDelegation()` in the Dynamic SDK), Dynamic fires a `wallet.delegation.revoked` webhook. Your webhook handler should immediately delete the corresponding Postgres record. After deletion, `getDelegation(userId)` returns `null` and the user receives a 403 until they re-approve delegation.
