/**
 * Postgres-backed delegation store.
 *
 * Stores per-user delegation credentials received from the Dynamic webhook.
 * Credentials are decrypted once at webhook time and stored in Postgres
 * so the agent can retrieve them on every request.
 *
 * Schema (see migrations/001_delegations.sql):
 *   delegations(id, user_id, wallet_id, address, chain, wallet_api_key, key_share, ...)
 */

import { sql } from "./db";
import type { ServerKeyShare } from "@dynamic-labs-wallet/node";

export interface DelegationRecord {
  userId: string;
  walletId: string;
  address: string;
  chain: string;
  walletApiKey: string;
  keyShare: ServerKeyShare;
}

/**
 * Upsert a delegation record. Called when the Dynamic webhook fires
 * after a user approves wallet delegation.
 */
export async function storeDelegation(record: DelegationRecord): Promise<void> {
  await sql`
    INSERT INTO delegations (user_id, wallet_id, address, chain, wallet_api_key, key_share, updated_at)
    VALUES (
      ${record.userId},
      ${record.walletId},
      ${record.address.toLowerCase()},
      ${record.chain},
      ${record.walletApiKey},
      ${sql.json(record.keyShare as any)},
      now()
    )
    ON CONFLICT (user_id, chain) DO UPDATE SET
      wallet_id     = EXCLUDED.wallet_id,
      address       = EXCLUDED.address,
      wallet_api_key = EXCLUDED.wallet_api_key,
      key_share     = EXCLUDED.key_share,
      updated_at    = now()
  `;

  console.log(
    `[delegation-store] Stored delegation for user ${record.userId} (${record.address})`
  );
}

/**
 * Retrieve the delegation record for a given user ID.
 * Returns the most recently created delegation (any chain).
 */
export async function getDelegation(
  userId: string
): Promise<DelegationRecord | null> {
  try {
    const rows = await sql`
      SELECT user_id, wallet_id, address, chain, wallet_api_key, key_share
      FROM delegations
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      userId: row.user_id,
      walletId: row.wallet_id,
      address: row.address,
      chain: row.chain,
      walletApiKey: row.wallet_api_key,
      keyShare: row.key_share as ServerKeyShare,
    };
  } catch (err) {
    console.error(`[delegation-store] Failed to get delegation:`, err);
    return null;
  }
}

/**
 * Delete all delegation records for a user. Called on wallet.delegation.revoked.
 */
export async function deleteDelegation(userId: string): Promise<void> {
  try {
    await sql`DELETE FROM delegations WHERE user_id = ${userId}`;
    console.log(`[delegation-store] Deleted delegation for user ${userId}`);
  } catch (err) {
    console.error(`[delegation-store] Failed to delete delegation:`, err);
  }
}
