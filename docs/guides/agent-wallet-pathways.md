# AI Agents with Dynamic Wallets

There are two ways to give an AI agent access to a Dynamic wallet:

1. **Direct (CLI/single-user)** — load credentials from environment variables at startup
2. **Delegated access (multi-user)** — each user approves via the Dynamic SDK; credentials arrive via webhook

| | Direct | Delegated access |
|---|---|---|
| Users | Single (you) | Any number |
| Credentials | Env vars | Postgres, per user |
| Best for | CLI tools, local dev | Backend APIs, mobile apps |

---

## Pathway 1: Direct (CLI)

Use this when you're building a CLI agent or single-user tool and want to get started quickly.

### Step 1: Get your credentials from Dynamic

In the Dynamic dashboard, find the wallet you want the agent to use and copy:
- Wallet ID
- Wallet address
- API key
- Key share (JSON)

### Step 2: Set environment variables

**Mode A — paste credentials directly (easiest):**

```env
DELEGATED_WALLET_ID=<wallet-uuid>
DELEGATED_WALLET_ADDRESS=0x...
DELEGATED_WALLET_API_KEY=<api-key>
DELEGATED_KEY_SHARE={"key":"..."}
```

**Mode B — paste the encrypted webhook payload (if you have it):**

```env
DELEGATION_KEY=<your RSA private key PEM>
DELEGATED_WALLET_ID=<wallet-uuid>
DELEGATED_WALLET_ADDRESS=0x...
ENCRYPTED_WALLET_API_KEY={"iv":"...","ct":"...","ek":"...","tag":"..."}
ENCRYPTED_KEY_SHARE={"iv":"...","ct":"...","ek":"...","tag":"..."}
```

### Step 3: Load credentials

`loadDelegationCredentials()` in `agent/clients/delegated-wallet.ts` handles both modes automatically:

```typescript
const creds = loadDelegationCredentials();
if (!creds) throw new Error("No delegation credentials found");
```

---

## Pathway 2: Delegated access (multi-user)

Use this when building a backend API or mobile app where each user delegates their own wallet.

### Step 1: User connects wallet via Dynamic

The user authenticates in your app with the Dynamic SDK. You get a JWT (`auth.token`) identifying them.

### Step 2: User approves delegation

Call the Dynamic SDK to start the delegation flow:

```typescript
const shouldPrompt = await dynamicClient.wallets.waas.delegation.shouldPromptWalletDelegation();
if (shouldPrompt) {
  await dynamicClient.wallets.waas.delegation.initDelegationProcess({});
}
```

When the user approves, Dynamic sends a `wallet.delegation.created` webhook to your server.

### Step 3: Webhook stores the credentials

Your server receives the webhook, decrypts the credentials, and stores them in Postgres keyed by the user's Dynamic ID. See the [delegated access webhook guide](./delegated-access-webhook.md) for setup.

### Step 4: Agent uses the credentials per-request

On each API request, fetch the stored credentials and pass them to the agent:

```typescript
const record = await getDelegation(user.sub);
if (!record) {
  return c.json({ error: "No delegation found. Please grant wallet access first." }, 403);
}

const response = await runAgentForUser(message, threadId, {
  walletId: record.walletId,
  walletAddress: record.address,
  walletApiKey: record.walletApiKey,
  keyShare: record.keyShare,
}, jwt);
```

### Step 5: User can revoke at any time

```typescript
const walletsStatus = await dynamicClient.wallets.waas.delegation.getWalletsDelegatedStatus();
const delegatedWallets = walletsStatus
  .filter((w) => w.isDelegated)
  .map((w) => ({ chainName: w.chainName, accountAddress: w.accountAddress }));
await dynamicClient.wallets.waas.delegation.revokeDelegation({ wallets: delegatedWallets });
```

Dynamic fires `wallet.delegation.revoked` → your server deletes the record → agent returns `403` until the user re-delegates.

---

## Signing with the delegated wallet

Both pathways use the same signing functions from `agent/clients/delegated-wallet.ts`. The `@dynamic-labs-wallet/node-evm` SDK handles the actual signing against Dynamic's API.

```typescript
// Sign a message
await signMessageDelegated(creds, "Hello");

// Sign typed data (used for Polymarket orders)
await signTypedDataDelegated(creds, typedData);

// Sign and broadcast a transaction
await sendTransactionDelegated(creds, chainId, to, data, value);
```

`sendTransactionDelegated` handles nonce and gas automatically.

---

## Supported chains

| Chain ID | Network |
|---|---|
| 1 | Ethereum |
| 137 | Polygon |
| 8453 | Base |
| 10 | Optimism |
| 42161 | Arbitrum |
| 56 | BSC |
| 43114 | Avalanche |
