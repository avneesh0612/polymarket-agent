/**
 * POST /api/webhooks/dynamic
 *
 * Handles Dynamic webhook events for wallet delegation.
 *
 * Events handled:
 * - wallet.delegation.created: decrypt materials, store delegation record
 * - wallet.delegation.revoked: remove delegation record
 * - ping: verify webhook is reachable
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/webhook-verify";
import { WebhookPayloadSchema } from "@/lib/webhook-schemas";
import { decryptMaterials } from "@/lib/decrypt";
import { storeDelegation, deleteDelegation } from "@/lib/delegation-store";
import type { ServerKeyShare } from "@dynamic-labs-wallet/node";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Step 1: Verify HMAC signature
  const verification = await verifyWebhookSignature(request);
  if (!verification.success) {
    return NextResponse.json(
      { error: verification.error },
      { status: verification.status }
    );
  }

  // Step 2: Parse and validate payload with Zod
  const parseResult = WebhookPayloadSchema.safeParse(verification.payload);
  if (!parseResult.success) {
    console.error(
      "[webhook] Unknown or malformed event:",
      parseResult.error.issues
    );
    // Return 200 so Dynamic doesn't retry unrecognized events
    return NextResponse.json({ received: true, handled: false });
  }

  const event = parseResult.data;

  switch (event.eventName) {
    case "ping": {
      console.log("[webhook] Received ping from Dynamic");
      return NextResponse.json({ received: true, handled: true });
    }

    case "wallet.delegation.created": {
      const { walletId, chain, publicKey, userId, encryptedDelegatedShare, encryptedWalletApiKey } =
        event.data;

      console.log(
        `[webhook] Delegation created for user ${userId}, wallet ${walletId} on ${chain}`
      );

      try {
        const { delegatedShare, walletApiKey } = decryptMaterials(
          encryptedDelegatedShare,
          encryptedWalletApiKey
        );

        await storeDelegation({
          userId,
          walletId,
          address: publicKey,
          chain,
          walletApiKey,
          keyShare: delegatedShare as unknown as ServerKeyShare,
        });

        console.log(
          `[webhook] Stored delegation for user ${userId} (address: ${publicKey})`
        );
        return NextResponse.json({ received: true, handled: true });
      } catch (err) {
        console.error("[webhook] Failed to decrypt/store delegation:", err);
        return NextResponse.json(
          { error: "Failed to process delegation" },
          { status: 500 }
        );
      }
    }

    case "wallet.delegation.revoked": {
      const { userId, walletId } = event.data;

      console.log(
        `[webhook] Delegation revoked for user ${userId}, wallet ${walletId}`
      );

      await deleteDelegation(userId);
      return NextResponse.json({ received: true, handled: true });
    }

    default: {
      // TypeScript exhaustiveness check — should never reach here
      return NextResponse.json({ received: true, handled: false });
    }
  }
}
