/**
 * Zod schemas for Dynamic webhook payloads.
 * Copied from the nextjs-delegated-access example — no @/env dependency.
 */

import { z } from "zod";

/**
 * Schema for encrypted data using RSA-OAEP + AES-GCM hybrid encryption.
 *
 * Fields:
 * - alg: Encryption algorithm identifier
 * - ek: Encrypted symmetric key (RSA-OAEP encrypted AES-256 key, base64url encoded)
 * - iv: Initialization vector for AES-GCM (base64url encoded)
 * - ct: Ciphertext (encrypted data, base64url encoded)
 * - tag: Authentication tag for AES-GCM (base64url encoded)
 * - kid: Key ID (optional)
 */
export const EncryptedDelegatedShareSchema = z.object({
  alg: z.string(),
  iv: z.string(),
  ct: z.string(),
  tag: z.string(),
  ek: z.string(),
  kid: z.string().optional(),
});

const BaseWebhookSchema = z.object({
  messageId: z.string(),
  eventId: z.string(),
  timestamp: z.string(),
  webhookId: z.string(),
  environmentId: z.string(),
  environmentName: z.string().optional(),
  userId: z.string().nullable(),
  redelivery: z.boolean().optional(),
});

export const PingEventSchema = BaseWebhookSchema.extend({
  eventName: z.literal("ping"),
  data: z.object({
    webhookId: z.string(),
    message: z.string(),
    events: z.array(z.string()),
    url: z.string(),
    isEnabled: z.boolean(),
  }),
});

export const DelegationCreatedEventSchema = BaseWebhookSchema.extend({
  eventName: z.literal("wallet.delegation.created"),
  data: z.object({
    encryptedDelegatedShare: EncryptedDelegatedShareSchema,
    walletId: z.string(),
    chain: z.string(),
    publicKey: z.string(),
    userId: z.string(),
    encryptedWalletApiKey: EncryptedDelegatedShareSchema,
  }),
});

export const DelegationRevokedEventSchema = BaseWebhookSchema.extend({
  eventName: z.literal("wallet.delegation.revoked"),
  data: z.object({
    walletId: z.string(),
    chain: z.string(),
    publicKey: z.string(),
    userId: z.string(),
  }),
});

export const WebhookPayloadSchema = z.discriminatedUnion("eventName", [
  DelegationCreatedEventSchema,
  DelegationRevokedEventSchema,
  PingEventSchema,
]);

export type EncryptedDelegatedShare = z.infer<
  typeof EncryptedDelegatedShareSchema
>;
export type DelegationCreatedEvent = z.infer<
  typeof DelegationCreatedEventSchema
>;
export type DelegationRevokedEvent = z.infer<
  typeof DelegationRevokedEventSchema
>;
export type PingEvent = z.infer<typeof PingEventSchema>;
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
