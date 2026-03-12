/**
 * Decrypts Dynamic delegation materials using RSA-OAEP + AES-GCM hybrid encryption.
 * Uses DYNAMIC_DELEGATION_PRIVATE_KEY from environment directly (no @/env dependency).
 */

import * as crypto from "crypto";
import type { EcdsaKeygenResult } from "@dynamic-labs-wallet/node";
import type { EncryptedDelegatedShare } from "@/lib/webhook-schemas";

function getPrivateKey(): string {
  const privateKeyPem = process.env.DYNAMIC_DELEGATION_PRIVATE_KEY;

  if (!privateKeyPem) {
    throw new Error(
      "DYNAMIC_DELEGATION_PRIVATE_KEY not found in environment variables. " +
        "Add your RSA private key to .env.local — see .env.local.example for setup."
    );
  }

  // Handle both inline \n escape sequences and actual newlines
  return privateKeyPem.replace(/\\n/g, "\n");
}

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

/**
 * Decrypts both the delegated share and wallet API key.
 *
 * Dynamic uses hybrid encryption:
 * 1. A random AES-256 key is generated
 * 2. The AES key is RSA-OAEP encrypted → stored in `ek`
 * 3. The actual data is AES-GCM encrypted → stored in `ct`
 *
 * We reverse this by:
 * 1. RSA-OAEP decrypting `ek` to get the AES key
 * 2. AES-GCM decrypting `ct` with that key
 */
export function decryptMaterials(
  share: EncryptedDelegatedShare,
  apiKeyEnc: EncryptedDelegatedShare
): { delegatedShare: EcdsaKeygenResult; walletApiKey: string } {
  const privateKeyPem = getPrivateKey();

  const shareKey = rsaOaepDecryptEk(privateKeyPem, share.ek);
  const walletApiKeyKey = rsaOaepDecryptEk(privateKeyPem, apiKeyEnc.ek);

  const delegatedShare = decryptAesGcm(
    shareKey,
    share.iv,
    share.ct,
    share.tag
  );
  const walletApiKey = decryptAesGcm(
    walletApiKeyKey,
    apiKeyEnc.iv,
    apiKeyEnc.ct,
    apiKeyEnc.tag
  );

  return {
    delegatedShare: JSON.parse(delegatedShare.toString("utf8")),
    walletApiKey: walletApiKey.toString("utf8"),
  };
}
