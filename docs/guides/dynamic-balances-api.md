# Dynamic Multi-Chain Balance API

This guide explains how the `get_token_balances` tool calls Dynamic's balance API to fetch token balances across multiple chains on behalf of the authenticated user.

The tool is implemented in both `agent/core/tools.ts` (standalone agent context) and `backend/src/lib/agent/tools.ts` (server context).

## Overview

Dynamic's balance API lets you fetch token balances for any wallet address across multiple chains. The API requires the user's JWT for authentication — every request is made on behalf of the currently authenticated user, so the balances returned reflect what that user's wallet holds.

The tool supports all major chain families (EVM, Solana, Bitcoin, Cosmos, and more) and can optionally fan out across several EVM networks in a single call, aggregating results before returning them to the agent.

---

## API Endpoint

```
GET https://app.dynamicauth.com/api/v0/sdk/{environmentId}/chains/{chain}/balances
```

| Path parameter | Description |
|----------------|-------------|
| `{environmentId}` | Your Dynamic environment ID, set via the `DYNAMIC_ENVIRONMENT_ID` environment variable |
| `{chain}` | The chain family to query (e.g. `EVM`, `SOL`). See [Supported chain types](#supported-chain-types) below |

### Query parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `accountAddress` | Yes | The wallet address whose balances to fetch |
| `includeNative` | Yes | Set to `true` to include the native token (ETH, MATIC, SOL, etc.) |
| `filterSpamTokens` | Yes | Set to `true` to suppress known spam/dust tokens |
| `networkId` | Yes (EVM) | The specific EVM network to query. The Dynamic EVM balance endpoint returns an empty array when this parameter is omitted, so the tool always supplies it |
| `includePrices` | No | Set to `true` to request USD prices and market values alongside balances |

---

## Authentication Headers

All four headers below are sent with every request:

```typescript
const headers: Record<string, string> = {
  Authorization: `Bearer ${userJwt}`,
  "Content-Type": "application/json",
  "x-dyn-version": "WalletKit/4.67.0",
  "x-dyn-api-version": "API/0.0.881",
};
if (sessionPublicKey) {
  headers["x-dyn-session-public-key"] = sessionPublicKey;
}
```

| Header | Purpose |
|--------|---------|
| `Authorization: Bearer {userJwt}` | Authenticates the request as the signed-in user. Dynamic validates this JWT before returning any data |
| `Content-Type: application/json` | Tells the API the request body format (required even for GET requests) |
| `x-dyn-version: WalletKit/4.67.0` | Identifies the WalletKit SDK version making the request |
| `x-dyn-api-version: API/0.0.881` | Identifies the API client version |
| `x-dyn-session-public-key` | The session-scoped public key embedded in the JWT. Sending this header improves request reliability — Dynamic can use it to correlate the request to the active session without full JWT validation on every hop |

---

## Extracting the Session Public Key from the JWT

The session public key is embedded in the JWT payload. Because it only needs to be read (not verified), the tool base64url-decodes the middle segment of the JWT directly:

```typescript
let sessionPublicKey: string | undefined;
try {
  const payload = JSON.parse(
    Buffer.from(userJwt.split(".")[1], "base64url").toString("utf8")
  );
  sessionPublicKey = payload.session_public_key;
} catch {}
```

The three segments of a JWT are separated by `.`. The middle segment (index `1`) is the payload, encoded as base64url. Decoding it yields the JSON claims object, which may contain a `session_public_key` field.

The extraction is wrapped in `try/catch` so that a malformed or missing field never blocks the balance request — the header is simply omitted if extraction fails.

---

## Supported Chain Types

The `chainName` parameter accepts the following values (case-insensitive — the tool uppercases the input before use):

| Chain | Description |
|-------|-------------|
| `EVM` | Any EVM-compatible chain (Ethereum, Polygon, Base, Arbitrum, BSC, Optimism, etc.). This is the default when no `chainName` is supplied |
| `ETH` | Ethereum specifically |
| `SOL` | Solana |
| `BTC` | Bitcoin |
| `COSMOS` | Cosmos ecosystem |
| `SUI` | Sui |
| `TRON` | Tron |
| `TON` | TON (Telegram Open Network) |
| `STELLAR` | Stellar |

---

## Network IDs

EVM chains are distinguished by their network (chain) ID. Common values used in this project:

| Network | ID |
|---------|----|
| Ethereum mainnet | 1 |
| Polygon | 137 |
| Base | 8453 |
| Arbitrum One | 42161 |
| Optimism | 10 |
| BSC (BNB Chain) | 56 |
| Avalanche C-Chain | 43114 |

---

## Fan-Out Across Networks

The Dynamic EVM balance API requires a `networkId` — omitting it returns an empty array. When the caller does not specify a `networkId`, the tool fans out across six popular EVM networks in parallel and merges the results:

```typescript
const networkIds = networkId
  ? [networkId]
  : [1, 137, 8453, 42161, 56, 10]; // mainnet, polygon, base, arbitrum, bsc, optimism

const fetchForNetwork = async (netId: number) => {
  const url = new URL(
    `https://app.dynamicauth.com/api/v0/sdk/${environmentId}/chains/${chain}/balances`
  );
  url.searchParams.set("accountAddress", agentWallet.walletAddress);
  url.searchParams.set("includeNative", "true");
  url.searchParams.set("filterSpamTokens", "true");
  url.searchParams.set("networkId", String(netId));
  if (includePrices) url.searchParams.set("includePrices", "true");

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

const results = await Promise.all(networkIds.map(fetchForNetwork));
const items = results.flat();
```

All six requests are issued concurrently via `Promise.all`. Individual network failures return an empty array and do not abort the overall call — the tool still returns whatever other networks responded with.

---

## Response Shape

Each token in the `tokens` array has the following shape:

```typescript
{
  name: string;       // Token name (e.g. "Ether", "USD Coin")
  symbol: string;     // Ticker symbol (e.g. "ETH", "USDC")
  balance: string;    // Formatted decimal string (e.g. "0.042")
  networkId: number;  // The EVM chain ID the token lives on
  isNative: boolean;  // true for the chain's native gas token
  priceUsd?: number;  // USD price per token — only present when includePrices=true
  valueUsd?: number;  // Total USD market value — only present when includePrices=true
}
```

The full tool response envelope:

```typescript
{
  success: boolean;
  address: string;    // The wallet address queried
  chain: string;      // Chain type used (e.g. "EVM")
  networkId: number | "all";
  tokens: Token[];
  message?: string;   // Informational note when tokens array is empty
}
```

---

## Using the Tool from the Agent

The agent invokes `get_token_balances` based on user intent. Common patterns:

| User request | Tool call |
|---|---|
| "Show my wallet balance" | `{ }` — defaults to `EVM` chain, fans out across all 6 networks |
| "Show my ETH balance" | `{ chainName: "ETH" }` |
| "Show my Polygon tokens" | `{ networkId: 137 }` |
| "Show my Solana balance" | `{ chainName: "SOL" }` |
| "Show my balances with USD values" | `{ includePrices: true }` |
| "What's my USDC on Base?" | `{ networkId: 8453, includePrices: true }` |

---

## Where the JWT Comes From in the Backend

In the server context (`backend/src/lib/agent/tools.ts`), the user's JWT is stored as a module-level singleton managed by `backend/src/lib/agent/credentials.ts`:

```typescript
// credentials.ts
export function setUserJWT(jwt: string): void {
  userJWT = jwt;
}

export function getUserJWT(): string | null {
  return userJWT;
}
```

At the start of each agent request, the server calls `setUserJWT(jwt)` with the JWT extracted from the incoming `Authorization` header. The balance tool then retrieves it via `getUserJWT()`.

> **Note:** Because `userJWT` is a module-level variable, this approach is not concurrent-safe. If two requests arrive simultaneously, credentials from one request may be used by the other. This is acceptable for single-user or development scenarios. For production multi-user deployments, pass credentials through a request-scoped context instead.

In the standalone agent context (`agent/core/tools.ts`), the JWT is read directly from the `DYNAMIC_USER_JWT` environment variable.

---

## Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DYNAMIC_ENVIRONMENT_ID` | Your Dynamic project environment ID. Used in the API URL path to scope all requests to your application |
| `DYNAMIC_USER_JWT` | (Standalone agent only) The user's Dynamic JWT. In the server context this is provided per-request via `setUserJWT` instead |
