# Delegated Access via Webhook

When a user approves wallet delegation in the Dynamic SDK, Dynamic sends the encrypted signing credentials to your server via webhook. This guide walks through setting that up end-to-end.

---

## How it works

1. User taps "Grant wallet access" in your app — this calls `initDelegationProcess()` in the Dynamic SDK.
2. Dynamic encrypts the user's signing credentials with your server's public key and POSTs them to your webhook endpoint.
3. Your server decrypts and stores the credentials in Postgres.
4. On each agent request, your server fetches those credentials and signs on behalf of the user.
5. If the user revokes, Dynamic fires another webhook and you delete the credentials.

---

## Step 1: Generate a key pair

Your server needs an RSA key pair. Dynamic encrypts the credentials with your **public key**; your server decrypts them with the **private key**.

```bash
openssl genrsa -out delegation_private.pem 4096
openssl rsa -in delegation_private.pem -pubout -out delegation_public.pem
```

Never commit the private key. Add it to `.env`:

```env
DYNAMIC_DELEGATION_PRIVATE_KEY="<your RSA private key PEM with newlines escaped as \\n>"
```

The PEM file has newlines — escape them as `\n` for a single-line `.env` value.

---

## Step 2: Register the webhook in the Dynamic dashboard

1. Go to [app.dynamic.xyz](https://app.dynamic.xyz) → your environment → **Integrations > Webhooks**.
2. Click **Add endpoint** and set the URL to your server's webhook route:
   ```
   https://your-domain.com/api/webhooks/dynamic
   ```
3. Paste the contents of `delegation_public.pem` into the **Public key** field.
4. Enable `wallet.delegation.created` and `wallet.delegation.revoked`.
5. Save and copy the **webhook secret** Dynamic shows you.

```env
DYNAMIC_WEBHOOK_SECRET="whsec_..."
```

> For local development, use [ngrok](https://ngrok.com) (`ngrok http 3001`) to get a public URL and register that instead.

---

## Step 3: Verify the webhook signature

Every request from Dynamic includes an `x-dynamic-signature-256` header. The handler in `backend/src/routes/webhooks.ts` verifies it before processing:

```typescript
const payloadSignature = crypto
  .createHmac("sha256", webhookSecret)
  .update(JSON.stringify(rawPayload))
  .digest("hex");

if (!crypto.timingSafeEqual(
  Buffer.from(`sha256=${payloadSignature}`),
  Buffer.from(signature)
)) {
  return c.json({ error: "Invalid signature" }, 401);
}
```

---

## Step 4: Decrypt and store

Dynamic encrypts the credentials with your public key. The `decryptMaterials()` function in `backend/src/lib/decrypt.ts` handles decryption automatically. After decryption, `storeDelegation()` upserts the credentials into Postgres:

```typescript
case "wallet.delegation.created": {
  const { walletId, chain, publicKey, userId, encryptedDelegatedShare, encryptedWalletApiKey } = event.data;
  const { delegatedShare, walletApiKey } = decryptMaterials(encryptedDelegatedShare, encryptedWalletApiKey);
  await storeDelegation({ userId, walletId, address: publicKey, chain, walletApiKey, keyShare: delegatedShare });
}
```

The `delegations` table has a unique constraint on `(user_id, chain)`, so re-delegation updates the existing record rather than creating a duplicate.

---

## Step 5: Handle revocation

When the user revokes access in the Dynamic SDK, Dynamic fires `wallet.delegation.revoked`. The handler deletes the record:

```typescript
case "wallet.delegation.revoked": {
  await deleteDelegation(event.data.userId);
}
```

After deletion, `getDelegation(userId)` returns `null` and the agent route returns `403` until the user re-delegates.

---

## Step 6: Use the credentials in your agent

Before running the agent, fetch the stored credentials for the requesting user:

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

---

## Webhook events

| Event | Trigger | What the handler does |
|---|---|---|
| `ping` | Webhook registration or test | Returns `{ received: true }`, no side effects |
| `wallet.delegation.created` | User approves delegation in the Dynamic SDK | Decrypts credentials, upserts into `delegations` |
| `wallet.delegation.revoked` | User revokes delegation in the Dynamic SDK | Deletes row from `delegations` |

---

## Environment variables

| Variable | Where to get it |
|---|---|
| `DYNAMIC_WEBHOOK_SECRET` | Dynamic dashboard → Integrations → Webhooks |
| `DYNAMIC_DELEGATION_PRIVATE_KEY` | Your generated RSA private key |
| `DYNAMIC_ENVIRONMENT_ID` | Dynamic dashboard → Overview |
| `DYNAMIC_API_KEY` | Dynamic dashboard → Overview |
