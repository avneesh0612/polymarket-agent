/**
 * Supabase-backed delegation store.
 *
 * Stores per-user delegation credentials received from the Dynamic webhook.
 * Credentials are decrypted once at webhook time and stored in Supabase
 * so the agent can retrieve them on every request.
 *
 * Schema (see supabase/migrations/001_delegations.sql):
 *   delegations(id, user_id, wallet_id, address, chain, wallet_api_key, key_share, ...)
 */

import { supabase } from "./supabase";
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
  const { error } = await supabase.from("delegations").upsert(
    {
      user_id: record.userId,
      wallet_id: record.walletId,
      address: record.address.toLowerCase(),
      chain: record.chain,
      wallet_api_key: record.walletApiKey,
      key_share: record.keyShare,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,chain" }
  );

  if (error) {
    throw new Error(`Failed to store delegation: ${error.message}`);
  }

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
  const { data, error } = await supabase
    .from("delegations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`[delegation-store] Failed to get delegation: ${error.message}`);
    return null;
  }

  if (!data) return null;

  return {
    userId: data.user_id,
    walletId: data.wallet_id,
    address: data.address,
    chain: data.chain,
    walletApiKey: data.wallet_api_key,
    keyShare: data.key_share as ServerKeyShare,
  };
}

/**
 * Delete all delegation records for a user. Called on wallet.delegation.revoked.
 */
export async function deleteDelegation(userId: string): Promise<void> {
  const { error } = await supabase
    .from("delegations")
    .delete()
    .eq("user_id", userId);

  if (error) {
    console.error(`[delegation-store] Failed to delete delegation: ${error.message}`);
  } else {
    console.log(`[delegation-store] Deleted delegation for user ${userId}`);
  }
}
