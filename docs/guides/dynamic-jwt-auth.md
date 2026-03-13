# Dynamic JWT Authentication

This guide explains how the backend verifies Dynamic-issued JWTs and uses the claims within them to authenticate users, scope data access, and authorize downstream API calls.

## Overview

When a user authenticates through the Dynamic SDK on the mobile app, Dynamic issues a signed JWT. Every API request from the mobile app includes this token as a `Bearer` header. The backend verifies the token against Dynamic's public signing keys before processing any protected request.

The flow is:

1. The user authenticates in the Dynamic SDK (client-side).
2. Dynamic issues a signed JWT containing the user's identity and linked wallet credentials.
3. The mobile app attaches the JWT as an `Authorization: Bearer <token>` header on every API request.
4. The backend verifies the JWT signature against Dynamic's public JWKS endpoint.
5. The verified `sub` claim (Dynamic user ID) is used as the user identifier throughout the system.

---

## How Dynamic JWTs Work

Dynamic signs JWTs using **RS256** (RSA + SHA-256). The corresponding public signing keys are published at a well-known JWKS endpoint scoped to your Dynamic environment:

```
https://app.dynamic.xyz/api/v0/sdk/{DYNAMIC_ENVIRONMENT_ID}/.well-known/jwks
```

The backend fetches these keys using the `jwks-rsa` library, which handles key rotation automatically. Keys are cached locally to avoid round-tripping to Dynamic's servers on every request.

---

## JWT Payload Structure

The `DynamicJwtPayload` interface (defined in `backend/src/lib/dynamic-auth.ts`) describes the claims the backend expects:

```typescript
interface DynamicJwtPayload extends JwtPayload {
  sub: string;                    // Dynamic user ID — used as userId everywhere in this system
  environment_id: string;         // Your Dynamic environment ID
  email: string;                  // User's email address (if linked)
  verified_credentials: [{        // All wallets linked to this user
    id: string;
    address: string;
    chain: string;                // e.g. "eip155", "solana"
    format: string;               // e.g. "blockchain"
    wallet_name: string;          // e.g. "metamask", "coinbase"
    wallet_provider: string;
  }];
  // Standard JWT fields inherited from JwtPayload: iat, exp, iss, aud
}
```

The payload may also contain a `session_public_key` field when the user is authenticated via a session key. The `get_token_balances` agent tool extracts this field and passes it as the `x-dyn-session-public-key` header when calling Dynamic's balance API.

---

## JWKS Client Setup

The JWKS client is initialized once at module load time in `backend/src/lib/dynamic-auth.ts`:

```typescript
const client = new JwksClient({
  jwksUri: `https://app.dynamic.xyz/api/v0/sdk/${DYNAMIC_ENV_ID}/.well-known/jwks`,
  rateLimit: true,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600_000, // 10 minutes in milliseconds
});
```

Key caching settings:

| Setting          | Value       | Effect                                              |
|------------------|-------------|-----------------------------------------------------|
| `cache`          | `true`      | Keys are cached in memory after the first fetch     |
| `cacheMaxEntries`| `5`         | At most 5 key IDs are kept in the cache             |
| `cacheMaxAge`    | `600_000`   | Each cached key expires after 10 minutes            |
| `rateLimit`      | `true`      | Prevents hammering the JWKS endpoint on cache misses|

---

## Verifying a JWT

The `verifyDynamicJWT(token)` function fetches the current signing key from the cached JWKS client and delegates signature verification to `jsonwebtoken`:

```typescript
export async function verifyDynamicJWT(token: string): Promise<DynamicJwtPayload | null> {
  try {
    const signingKey = await client.getSigningKey();
    const publicKey = signingKey.getPublicKey();
    return jwt.verify(token, publicKey) as DynamicJwtPayload;
  } catch (error) {
    console.error("JWT verification failed:", error);
    return null;
  }
}
```

`jwt.verify` validates the signature, expiry (`exp`), and issued-at (`iat`) claims. Any failure — expired token, wrong issuer, invalid signature — causes the function to return `null` rather than throw, so callers always deal with a simple nullable check.

---

## The `withAuth` Middleware

`withAuth(c)` is a thin wrapper that reads the `Authorization` header from a Hono request context and calls `verifyDynamicJWT`. It is called at the top of every protected route handler:

```typescript
export async function withAuth(c: Context): Promise<AuthenticatedUser | null> {
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  return verifyDynamicJWT(token);
}
```

The pattern in every protected route is:

```typescript
const user = await withAuth(c);
if (!user) return c.json({ error: "Unauthorized" }, 401);
// user.sub is now the verified Dynamic user ID
```

This pattern appears in three routes:

- **Agent route** (`routes/agent.ts`) — verifies the user before running the LangGraph agent.
- **Delegation route** (`routes/delegation.ts`) — verifies the user before returning delegation status.
- **History route** (`routes/history.ts`) — verifies the user before returning chat history.

---

## Using `user.sub` as the User Identifier

Once a token is verified, `user.sub` (the Dynamic user ID) is used as the canonical user identifier throughout the system:

| Use case                  | Code                                               |
|---------------------------|----------------------------------------------------|
| Look up delegation record | `getDelegation(user.sub)`                          |
| Save a chat message       | `saveChatMessage(user.sub, threadId, role, text)`  |
| Retrieve chat history     | `getChatHistory(user.sub, threadId)`               |
| Default LangGraph thread  | `const effectiveThreadId = threadId ?? user.sub`   |

This means every piece of user data — delegations, chat history, agent threads — is keyed by the Dynamic user ID, giving a consistent identity layer across the system.

---

## Passing the JWT to Agent Tools

The raw JWT is also forwarded to `runAgentForUser()` so that agent tools can make authenticated calls to Dynamic's APIs on behalf of the user. In `routes/agent.ts`:

```typescript
const authHeader = c.req.header("authorization") ?? "";
const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
const response = await runAgentForUser(message, threadId, creds, jwt);
```

Inside `runAgentForUser`, the `get_token_balances` tool uses the JWT to call Dynamic's multi-chain balance API. It also extracts `session_public_key` from the JWT payload and, when present, attaches it as the `x-dyn-session-public-key` header — a requirement for session-key-authenticated users:

```typescript
const payload = JSON.parse(
  Buffer.from(userJwt.split(".")[1], "base64url").toString("utf8")
);
sessionPublicKey = payload.session_public_key;

const headers: Record<string, string> = {
  Authorization: `Bearer ${userJwt}`,
  "x-dyn-version": "WalletKit/4.67.0",
  "x-dyn-api-version": "API/0.0.881",
};
if (sessionPublicKey) {
  headers["x-dyn-session-public-key"] = sessionPublicKey;
}
```

---

## Required Environment Variable

| Variable                 | Description                                                                 |
|--------------------------|-----------------------------------------------------------------------------|
| `DYNAMIC_ENVIRONMENT_ID` | Your Dynamic environment ID. Used to construct the JWKS URL at startup.    |

If this variable is not set, the JWKS URL will be malformed and all JWT verification will fail.

---

## Error Handling

`verifyDynamicJWT` returns `null` — and never throws — on any verification failure. The cases that trigger a `null` return include:

- Token has expired (`exp` claim is in the past).
- Token signature does not match the current JWKS keys.
- Token was issued for a different Dynamic environment (`environment_id` mismatch).
- Token is structurally invalid or otherwise malformed.

All protected routes treat a `null` return as a 401 and halt processing immediately:

```typescript
if (!user) return c.json({ error: "Unauthorized" }, 401);
```

Verification errors are logged to `console.error` with the raw error so they can be observed in server logs without leaking details to the client.
