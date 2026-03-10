/**
 * Delegated wallet support for the AI agent.
 *
 * The user approves delegation in the Dynamic SDK (client-side).
 * Dynamic's webhook delivers encrypted credentials to this server.
 * This module decrypts and manages those credentials so the agent
 * can sign on behalf of the user's wallet across any EVM chain.
 */

import crypto from "crypto";
import {
  createDelegatedEvmWalletClient,
  delegatedSignMessage,
  delegatedSignTransaction,
  delegatedSignTypedData,
  type DelegatedEvmWalletClient,
} from "@dynamic-labs-wallet/node-evm";
import type { ServerKeyShare } from "@dynamic-labs-wallet/node";
import { createPublicClient, http } from "viem";
import {
  polygon,
  mainnet,
  base,
  optimism,
  arbitrum,
  bsc,
  avalanche,
} from "viem/chains";
import type { Chain, TransactionSerializable } from "viem";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DelegationCredentials {
  walletId: string;
  walletAddress: string;
  walletApiKey: string;
  keyShare: ServerKeyShare;
}

interface HybridEncrypted {
  alg: string;
  ct: string;
  ek: string;
  iv: string;
  tag: string;
  kid?: string;
}

// ─── Chain Map ────────────────────────────────────────────────────────────────

const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  137: polygon,
  8453: base,
  10: optimism,
  42161: arbitrum,
  56: bsc,
  43114: avalanche,
};

export function getChainById(chainId: number): Chain {
  return (
    CHAIN_MAP[chainId] ?? {
      id: chainId,
      name: `Chain ${chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: { http: [`https://rpc.ankr.com/eth`] },
        public: { http: [`https://rpc.ankr.com/eth`] },
      },
    }
  );
}

export function getPublicClientForChain(chainId: number) {
  const rpc = chainId === 137 ? "https://polygon.drpc.org" : undefined;
  return createPublicClient({
    chain: getChainById(chainId),
    transport: http(rpc),
  });
}

// Polygon public client (used by polymarket-client.ts)
export const polygonPublicClient = createPublicClient({
  chain: polygon,
  transport: http("https://polygon.drpc.org"),
});

// ─── Decryption ───────────────────────────────────────────────────────────────

/**
 * Decrypts HYBRID-RSA-AES-256 payloads from Dynamic's webhook.
 * RSA-OAEP-SHA256 decrypts the AES key; AES-256-GCM decrypts the data.
 */
export function decryptHybridRsaAes256(
  encrypted: HybridEncrypted,
  rsaPrivateKeyPem: string
): Buffer {
  const encryptedKey = Buffer.from(encrypted.ek, "base64url");
  const ciphertext = Buffer.from(encrypted.ct, "base64url");
  const iv = Buffer.from(encrypted.iv, "base64url");
  const tag = Buffer.from(encrypted.tag, "base64url");

  const aesKey = crypto.privateDecrypt(
    {
      key: rsaPrivateKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    encryptedKey
  );

  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ─── Credential Loading ────────────────────────────────────────────────────────

/**
 * Loads delegation credentials from environment variables.
 *
 * **Mode A — pre-decrypted** (simplest for dev):
 *   DELEGATED_WALLET_ID, DELEGATED_WALLET_ADDRESS,
 *   DELEGATED_WALLET_API_KEY, DELEGATED_KEY_SHARE (JSON string)
 *
 * **Mode B — decrypt at startup** (from webhook):
 *   DELEGATION_KEY (RSA private key PEM),
 *   DELEGATED_WALLET_ID, DELEGATED_WALLET_ADDRESS,
 *   ENCRYPTED_WALLET_API_KEY (JSON), ENCRYPTED_KEY_SHARE (JSON)
 */
export function loadDelegationCredentials(): DelegationCredentials | null {
  const walletId = process.env.DELEGATED_WALLET_ID;
  const walletAddress = process.env.DELEGATED_WALLET_ADDRESS;
  if (!walletId || !walletAddress) return null;

  // Mode A: pre-decrypted
  const preApiKey = process.env.DELEGATED_WALLET_API_KEY;
  const preKeyShare = process.env.DELEGATED_KEY_SHARE;
  if (preApiKey && preKeyShare) {
    try {
      return {
        walletId,
        walletAddress,
        walletApiKey: preApiKey,
        keyShare: JSON.parse(preKeyShare) as ServerKeyShare,
      };
    } catch {
      console.warn("[delegation] Failed to parse DELEGATED_KEY_SHARE JSON");
    }
  }

  // Mode B: decrypt from webhook payload
  const delegationKey = process.env.DELEGATION_KEY;
  const encApiKeyJson = process.env.ENCRYPTED_WALLET_API_KEY;
  const encKeyShareJson = process.env.ENCRYPTED_KEY_SHARE;
  if (delegationKey && encApiKeyJson && encKeyShareJson) {
    try {
      const encApiKey = JSON.parse(encApiKeyJson) as HybridEncrypted;
      const encKeyShare = JSON.parse(encKeyShareJson) as HybridEncrypted;

      const walletApiKey = decryptHybridRsaAes256(
        encApiKey,
        delegationKey
      ).toString("utf8");
      const keyShare = JSON.parse(
        decryptHybridRsaAes256(encKeyShare, delegationKey).toString("utf8")
      ) as ServerKeyShare;

      return { walletId, walletAddress, walletApiKey, keyShare };
    } catch (err) {
      console.warn("[delegation] Failed to decrypt credentials:", err);
    }
  }

  return null;
}

// ─── Delegated Client Singleton ───────────────────────────────────────────────

let _delegatedClient: DelegatedEvmWalletClient | null = null;

export function getDelegatedEvmClient(): DelegatedEvmWalletClient {
  if (!_delegatedClient) {
    const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID;
    const apiKey = process.env.DYNAMIC_API_KEY;
    if (!environmentId || !apiKey) {
      throw new Error(
        "DYNAMIC_ENVIRONMENT_ID and DYNAMIC_API_KEY are required for delegated signing"
      );
    }
    _delegatedClient = createDelegatedEvmWalletClient({ environmentId, apiKey });
  }
  return _delegatedClient;
}

// ─── Signing Helpers ──────────────────────────────────────────────────────────

/**
 * Sign a transaction using Dynamic's MPC — returns the signed serialized tx
 * WITHOUT broadcasting it. Used by viem wallet clients (e.g. LI.FI SDK).
 */
export async function signTransactionOnlyDelegated(
  creds: DelegationCredentials,
  transaction: TransactionSerializable
): Promise<`0x${string}`> {
  const signed = await delegatedSignTransaction(getDelegatedEvmClient(), {
    walletId: creds.walletId,
    walletApiKey: creds.walletApiKey,
    keyShare: creds.keyShare,
    transaction,
  });
  return signed as `0x${string}`;
}

export async function signMessageDelegated(
  creds: DelegationCredentials,
  message: string
): Promise<string> {
  return delegatedSignMessage(getDelegatedEvmClient(), {
    walletId: creds.walletId,
    walletApiKey: creds.walletApiKey,
    keyShare: creds.keyShare,
    message,
  });
}

export async function signTypedDataDelegated(
  creds: DelegationCredentials,
  typedData: any
): Promise<string> {
  return delegatedSignTypedData(getDelegatedEvmClient(), {
    walletId: creds.walletId,
    walletApiKey: creds.walletApiKey,
    keyShare: creds.keyShare,
    typedData,
  });
}

/**
 * Sign and broadcast a transaction on any EVM chain using the delegated wallet.
 */
export async function sendTransactionDelegated(
  creds: DelegationCredentials,
  chainId: number,
  to: string,
  data: string | undefined,
  value: bigint | undefined,
  gasOverride?: bigint
): Promise<string> {
  const chain = getChainById(chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  const address = creds.walletAddress as `0x${string}`;

  const nonce = await publicClient.getTransactionCount({ address });
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const baseFee = block.baseFeePerGas ?? BigInt(30_000_000_000);
  const maxPriorityFeePerGas = BigInt(1_500_000_000);
  const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

  let gas = gasOverride;
  if (!gas) {
    try {
      const estimated = await publicClient.estimateGas({
        account: address,
        to: to as `0x${string}`,
        data: data as `0x${string}` | undefined,
        value,
      });
      gas = (estimated * 12n) / 10n; // 20% buffer
    } catch {
      gas = BigInt(500_000); // safe fallback
    }
  }

  const transaction: TransactionSerializable = {
    type: "eip1559",
    chainId,
    to: to as `0x${string}`,
    data: data as `0x${string}` | undefined,
    value,
    nonce,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
  };

  const signedTx = await delegatedSignTransaction(getDelegatedEvmClient(), {
    walletId: creds.walletId,
    walletApiKey: creds.walletApiKey,
    keyShare: creds.keyShare,
    transaction,
  });

  return publicClient.sendRawTransaction({
    serializedTransaction: signedTx as `0x${string}`,
  });
}
