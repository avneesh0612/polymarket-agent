# Delegated Access via Webhook

This guide explains how the delegated access flow works end-to-end: from a user approving signing rights in the Dynamic SDK, through Dynamic's webhook delivering encrypted MPC key shares to your server, to your agent signing transactions on behalf of the user's wallet.

## Overview

Delegated access allows a server-side agent to sign transactions using a user's wallet without requiring the user to be online. The flow is:

1. The user approves wallet delegation in the Dynamic SDK (client-side).
2. Dynamic generates an encrypted MPC key share and encrypted wallet API key, then POSTs them to your registered webhook endpoint.
3. Your server decrypts the key materials using your RSA private key and stores them in Postgres.
4. When the agent needs to sign, it retrieves the stored credentials and uses the `@dynamic-labs-wallet/node` SDK to sign on behalf of the user.
5. If the user revokes access, Dynamic fires a `wallet.delegation.revoked` event and your server deletes the stored credentials.

---

## Step 1: Generate an RSA Key Pair

Your server needs an RSA key pair to decrypt the key shares Dynamic sends. Dynamic encrypts the materials with your **public key**; your server decrypts them with the **private key**.

Generate a 4096-bit key pair:

```bash
openssl genrsa -out delegation_private.pem 4096
openssl rsa -in delegation_private.pem -pubout -out delegation_public.pem
```

Keep `delegation_private.pem` on your server only — never commit it or share it. You will upload `delegation_public.pem` to the Dynamic dashboard in the next step.

### Add the private key to your environment

Add `DYNAMIC_DELEGATION_PRIVATE_KEY` to your `.env` file. Because `.env` files do not support literal newlines in values, escape them with `\n` on a single line:

The PEM file produced by `openssl` uses the standard `BEGIN PRIVATE KEY` / `END PRIVATE KEY` header and footer with base64-encoded key material in between. When placing this in a `.env` file, you have two options:

**Option A — single-line value (most portable):** Replace every newline in the PEM with the two-character literal `\n`:

```env
DYNAMIC_DELEGATION_PRIVATE_KEY="<PEM header>\n<base64 lines joined with \n>\n<PEM footer>\n"
```

**Option B — multi-line value:** Preserve the real newlines inside the quoted value (supported by most `.env` parsers that handle multi-line strings).

The server handles both formats — `backend/src/lib/decrypt.ts` normalises inline `\n` escape sequences to real newlines before using the key:

```typescript
return privateKeyPem.replace(/\\n/g, "\n");
```

---

## Step 2: Register the Webhook in the Dynamic Dashboard

1. Log in to the [Dynamic dashboard](https://app.dynamic.xyz) and open your environment.
2. Go to **Integrations > Webhooks**.
3. Click **Add endpoint** and set the URL to your server's webhook route, e.g.:
   ```
   https://your-domain.com/api/webhooks/dynamic
   ```
4. Paste the contents of `delegation_public.pem` into the **Public key** field.
5. Enable the **wallet.delegation.created** and **wallet.delegation.revoked** event types.
6. Save. Dynamic will display a **webhook secret** — copy it immediately.
7. Add the secret to your environment:
   ```env
   DYNAMIC_WEBHOOK_SECRET="whsec_..."
   ```

> **Local development:** Use [ngrok](https://ngrok.com) to expose your local server:
> ```bash
> ngrok http 3001
> ```
> Then register the ngrok URL (e.g. `https://abc123.ngrok.io/api/webhooks/dynamic`) as the webhook endpoint. Remember to update it whenever ngrok assigns a new URL.

---

## Step 3: Verify the Webhook Signature

Every request from Dynamic includes an `x-dynamic-signature-256` header. Your server must verify this before processing the payload to prevent spoofed requests.

The handler in `backend/src/routes/webhooks.ts` computes an HMAC-SHA256 over the raw JSON body using the webhook secret, then compares it to the header value using a timing-safe comparison to prevent timing attacks:

```typescript
const payloadSignature = crypto
  .createHmac("sha256", webhookSecret)
  .update(JSON.stringify(rawPayload))
  .digest("hex");

const trusted = Buffer.from(`sha256=${payloadSignature}`, "ascii");
const untrusted = Buffer.from(signature, "ascii");

if (trusted.length !== untrusted.length || !crypto.timingSafeEqual(trusted, untrusted)) {
  return c.json({ error: "Invalid signature" }, 401);
}
```

If the signature does not match, the handler returns `401` immediately without processing the payload.

---

## Step 4: Decrypt the Key Materials

Dynamic uses **hybrid encryption** to deliver the key share and wallet API key:

1. Dynamic generates a random AES-256 key.
2. That AES key is encrypted with RSA-OAEP (SHA-256) using your public key → stored in the `ek` field.
3. The actual data (key share or wallet API key) is encrypted with AES-256-GCM using that AES key → stored in `ct`, `iv`, and `tag`.

To decrypt, your server reverses these two steps:

**Step A — RSA-OAEP decrypt `ek` to recover the AES key:**

```typescript
function rsaOaepDecryptEk(privateKeyPem: string, ekB64: string): Buffer {
  return crypto.privateDecrypt(
    {
      key: privateKeyPem,
      oaepHash: "sha256",
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(ekB64, "base64url")
  );
}
```

**Step B — AES-256-GCM decrypt `ct` with the recovered AES key:**

```typescript
function decryptAesGcm(
  symmetricKey: Buffer,
  ivB64: string,
  ctB64: string,
  tagB64: string
): Buffer {
  const iv = Buffer.from(ivB64, "base64url");
  const ciphertext = Buffer.from(ctB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", symmetricKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
```

Both steps are combined in `decryptMaterials` (in `backend/src/lib/decrypt.ts`), which is called for both the delegated key share and the wallet API key:

```typescript
const shareKey = rsaOaepDecryptEk(privateKeyPem, share.ek);
const delegatedShare = decryptAesGcm(shareKey, share.iv, share.ct, share.tag);

const walletApiKeyKey = rsaOaepDecryptEk(privateKeyPem, apiKeyEnc.ek);
const walletApiKey = decryptAesGcm(walletApiKeyKey, apiKeyEnc.iv, apiKeyEnc.ct, apiKeyEnc.tag);
```

The `EncryptedDelegatedShare` envelope that arrives in the webhook payload has the following shape (defined in `backend/src/lib/webhook-schemas.ts`):

```typescript
{
  alg: string;   // encryption algorithm identifier
  ek:  string;   // RSA-OAEP encrypted AES key (base64url)
  iv:  string;   // AES-GCM initialisation vector (base64url)
  ct:  string;   // ciphertext (base64url)
  tag: string;   // AES-GCM authentication tag (base64url)
  kid?: string;  // optional key ID
}
```

---

## Step 5: Store the Credentials in Postgres

After decryption, the credentials are upserted into the `delegations` table. The schema is defined in `backend/migrations/001_init.sql`:

```sql
create table if not exists delegations (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  wallet_id      text not null,
  address        text not null,       -- lowercase wallet address
  chain          text not null,       -- e.g. "EVM", "eip155:1"
  wallet_api_key text not null,       -- decrypted Dynamic wallet API key
  key_share      jsonb not null,      -- decrypted ECDSA keygen result
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (user_id, chain)
);
```

The unique constraint on `(user_id, chain)` means that if a user re-grants delegation on the same chain, the existing row is updated rather than duplicated (upsert behaviour in `storeDelegation`).

The wallet address is stored in lowercase for consistent lookups. Indexes on `user_id` and `address` ensure fast retrieval.

---

## Step 6: Handle Revocation

When a user revokes wallet access in the Dynamic SDK, Dynamic fires a `wallet.delegation.revoked` event. The webhook handler calls `deleteDelegation(userId)`, which removes **all** delegation rows for that user:

```typescript
case "wallet.delegation.revoked": {
  const { userId } = event.data;
  await deleteDelegation(userId);
  return c.json({ received: true, handled: true });
}
```

The `deleteDelegation` function in `backend/src/lib/delegation-store.ts`:

```typescript
await sql`DELETE FROM delegations WHERE user_id = ${userId}`;
```

After revocation, any subsequent agent request for that user will receive a `403` response (see Step 7), prompting the user to re-grant access if needed.

---

## Step 7: Retrieve Credentials in the Agent

Before running the agent, the agent route (`backend/src/routes/agent.ts`) calls `getDelegation(userId)` to fetch the stored credentials. If no delegation is found, it returns a `403` immediately:

```typescript
const record = await getDelegation(user.sub);
if (!record) {
  return c.json({ error: "No delegation found. Please grant wallet access first." }, 403);
}

const creds: DelegationCredentials = {
  walletId: record.walletId,
  walletAddress: record.address,
  walletApiKey: record.walletApiKey,
  keyShare: record.keyShare,
};

const response = await runAgentForUser(message.trim(), effectiveThreadId, creds, jwt);
```

The `keyShare` and `walletApiKey` are passed into `runAgentForUser`, which uses the `@dynamic-labs-wallet/node` SDK to reconstruct the wallet signer and submit transactions on behalf of the user.

---

## Webhook Event Schemas

Three event types are handled by the webhook route:

| Event name | Trigger | Action |
|---|---|---|
| `ping` | Sent when you first register or test the webhook | Responds `{ received: true, handled: true }` — no side effects |
| `wallet.delegation.created` | User approves delegation in the Dynamic SDK | Decrypts materials, upserts row in `delegations` |
| `wallet.delegation.revoked` | User revokes delegation in the Dynamic SDK | Deletes all rows for that `userId` in `delegations` |

Any unrecognised event names are parsed by the Zod schema (`WebhookPayloadSchema`) and return `{ received: true, handled: false }` without throwing an error.

---

## Environment Variables

| Variable | Description |
|---|---|
| `DYNAMIC_WEBHOOK_SECRET` | Webhook signing secret from the Dynamic dashboard. Used to verify `x-dynamic-signature-256`. |
| `DYNAMIC_DELEGATION_PRIVATE_KEY` | RSA private key PEM. Escape newlines as `\n` for a single-line `.env` value. |
| `DYNAMIC_ENVIRONMENT_ID` | Your Dynamic environment ID, from the dashboard. |
| `DYNAMIC_API_KEY` | Your Dynamic API key, from the dashboard. |

Example `.env` snippet:

```env
DYNAMIC_ENVIRONMENT_ID="your-environment-id"
DYNAMIC_API_KEY="your-api-key"
DYNAMIC_WEBHOOK_SECRET="whsec_..."
DYNAMIC_DELEGATION_PRIVATE_KEY="<your RSA private key PEM with newlines escaped as \\n>"
```

---

## Testing Locally with ngrok

During development your server is not publicly reachable, so Dynamic cannot deliver webhooks to `localhost`. Use ngrok to create a temporary public tunnel:

```bash
# Install ngrok (https://ngrok.com/download), then:
ngrok http 3001
```

ngrok will print a forwarding URL such as `https://abc123.ngrok-free.app`. Register that URL plus the route path as your webhook endpoint in the Dynamic dashboard:

```
https://abc123.ngrok-free.app/api/webhooks/dynamic
```

Update the URL in the dashboard whenever ngrok assigns a new one (each `ngrok http` invocation gets a new URL unless you have a reserved domain).

To trigger a test event, use the **Send test event** button in the Dynamic dashboard webhooks UI. The `ping` event is a safe way to confirm that signature verification is working before testing an actual delegation flow.
