import { Hono } from "hono";
import crypto from "crypto";
import { WebhookPayloadSchema } from "../lib/webhook-schemas";
import { decryptMaterials } from "../lib/decrypt";
import { storeDelegation, deleteDelegation } from "../lib/delegation-store";
import type { ServerKeyShare } from "@dynamic-labs-wallet/node";

export const webhooksRoute = new Hono();

webhooksRoute.post("/dynamic", async (c) => {
  const webhookSecret = process.env.DYNAMIC_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return c.json({ error: "Webhook secret not configured" }, 500);
  }

  const signature = c.req.header("x-dynamic-signature-256");
  if (!signature) {
    return c.json({ error: "No signature provided" }, 401);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const payloadSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(JSON.stringify(rawPayload))
    .digest("hex");

  const trusted = Buffer.from(`sha256=${payloadSignature}`, "ascii");
  const untrusted = Buffer.from(signature, "ascii");

  if (trusted.length !== untrusted.length || !crypto.timingSafeEqual(trusted, untrusted)) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const parseResult = WebhookPayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    console.error("[webhook] Unknown event:", parseResult.error.issues);
    return c.json({ received: true, handled: false });
  }

  const event = parseResult.data;

  switch (event.eventName) {
    case "ping": {
      console.log("[webhook] Ping received");
      return c.json({ received: true, handled: true });
    }
    case "wallet.delegation.created": {
      const { walletId, chain, publicKey, userId, encryptedDelegatedShare, encryptedWalletApiKey } = event.data;
      console.log(`[webhook] Delegation created for user ${userId}`);
      try {
        const { delegatedShare, walletApiKey } = decryptMaterials(encryptedDelegatedShare, encryptedWalletApiKey);
        await storeDelegation({
          userId,
          walletId,
          address: publicKey,
          chain,
          walletApiKey,
          keyShare: delegatedShare as unknown as ServerKeyShare,
        });
        return c.json({ received: true, handled: true });
      } catch (err) {
        console.error("[webhook] Failed to decrypt/store:", err);
        return c.json({ error: "Failed to process delegation" }, 500);
      }
    }
    case "wallet.delegation.revoked": {
      const { userId } = event.data;
      await deleteDelegation(userId);
      return c.json({ received: true, handled: true });
    }
    default:
      return c.json({ received: true, handled: false });
  }
});
