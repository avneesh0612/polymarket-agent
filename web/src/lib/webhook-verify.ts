/**
 * Webhook signature verification for Dynamic webhooks.
 * Uses DYNAMIC_WEBHOOK_SECRET from environment directly (no @/env dependency).
 *
 * Security: uses crypto.timingSafeEqual to prevent timing attacks.
 */

import crypto from "crypto";
import type { NextRequest } from "next/server";

export async function verifyWebhookSignature(
  request: NextRequest
): Promise<
  | { success: true; payload: unknown }
  | { success: false; error: string; status: number }
> {
  const webhookSecret = process.env.DYNAMIC_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("DYNAMIC_WEBHOOK_SECRET is not configured");
    return {
      success: false,
      error: "Webhook secret not configured",
      status: 500,
    };
  }

  // Dynamic sends the signature in the x-dynamic-signature-256 header
  const signature = request.headers.get("x-dynamic-signature-256");
  if (!signature) {
    console.error("No signature provided in webhook request");
    return {
      success: false,
      error: "No signature provided",
      status: 401,
    };
  }

  let rawPayload: unknown;
  try {
    rawPayload = await request.json();
  } catch (error) {
    console.error("Failed to parse webhook payload:", error);
    return {
      success: false,
      error: "Invalid JSON payload",
      status: 400,
    };
  }

  // Compute HMAC SHA256 of the JSON payload
  const payloadSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(JSON.stringify(rawPayload))
    .digest("hex");

  const trusted = Buffer.from(`sha256=${payloadSignature}`, "ascii");
  const untrusted = Buffer.from(signature, "ascii");

  // Constant-time comparison to prevent timing attacks
  if (trusted.length !== untrusted.length) {
    console.error("Invalid webhook signature (length mismatch)");
    return {
      success: false,
      error: "Invalid signature",
      status: 401,
    };
  }

  const isValid = crypto.timingSafeEqual(trusted, untrusted);

  if (!isValid) {
    console.error("Invalid webhook signature");
    return {
      success: false,
      error: "Invalid signature",
      status: 401,
    };
  }

  return { success: true, payload: rawPayload };
}
