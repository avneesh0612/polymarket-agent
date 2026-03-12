/**
 * Per-request agent credentials management.
 *
 * NOTE: agentWallet and userJWT are module-level variables. This means they are
 * NOT concurrent-safe — if multiple requests arrive simultaneously, credentials
 * from one request may bleed into another. This is acceptable for single-user
 * scenarios, but for production multi-user deployments you should pass credentials
 * through a request-scoped context instead.
 */

import type { ServerKeyShare } from "@dynamic-labs-wallet/node";

export interface DelegationCredentials {
  walletId: string;
  walletAddress: string;
  walletApiKey: string;
  keyShare: ServerKeyShare;
}

// Module-level credential singletons — NOT concurrent-safe (see note above)
export let agentWallet: DelegationCredentials | null = null;
export let userJWT: string | null = null;

export function setAgentWallet(creds: DelegationCredentials): void {
  agentWallet = creds;
  console.log(`[agent-wallet] Loaded delegated wallet: ${creds.walletAddress}`);
}

export function getAgentWallet(): DelegationCredentials | null {
  return agentWallet;
}

export function setUserJWT(jwt: string): void {
  userJWT = jwt;
}

export function getUserJWT(): string | null {
  return userJWT;
}
