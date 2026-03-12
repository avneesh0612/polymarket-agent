/**
 * Core agent tools for wallet management and token balances.
 * Web version — uses credentials from the credentials module instead of
 * a static .env file. The userJWT is set per-request via setUserJWT().
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { agentWallet, getUserJWT } from "./credentials";

function formatToolError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return JSON.stringify({ success: false, error: message });
}

export const listWalletsTool = tool(
  async () => {
    if (!agentWallet) {
      return JSON.stringify({ wallets: [], message: "No agent wallet loaded" });
    }
    return JSON.stringify({
      wallets: [
        {
          label: "agent",
          address: agentWallet.walletAddress,
          type: "delegated (user's wallet)",
        },
      ],
    });
  },
  {
    name: "list_wallets",
    description: "Show the agent's delegated wallet address",
    schema: z.object({}),
  }
);

const DYNAMIC_CHAIN_NAMES = [
  "ETH", "EVM", "SOL", "BTC", "COSMOS", "SUI", "TRON", "TON", "STELLAR",
] as const;

export const getTokenBalancesTool = tool(
  async ({ chainName, networkId, includePrices }) => {
    try {
      if (!agentWallet) {
        return JSON.stringify({
          success: false,
          error: "No agent wallet loaded. Delegation credentials not available.",
        });
      }

      const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID;
      const userJwt = getUserJWT();
      if (!environmentId || !userJwt) {
        return JSON.stringify({
          success: false,
          error: "DYNAMIC_ENVIRONMENT_ID or user JWT not set",
        });
      }

      const chain = chainName?.toUpperCase() ?? "EVM";

      let sessionPublicKey: string | undefined;
      try {
        const payload = JSON.parse(
          Buffer.from(userJwt.split(".")[1], "base64url").toString("utf8")
        );
        sessionPublicKey = payload.session_public_key;
      } catch {}

      const headers: Record<string, string> = {
        Authorization: `Bearer ${userJwt}`,
        "Content-Type": "application/json",
        "x-dyn-version": "WalletKit/4.67.0",
        "x-dyn-api-version": "API/0.0.881",
      };
      if (sessionPublicKey) {
        headers["x-dyn-session-public-key"] = sessionPublicKey;
      }

      // Fan out across popular EVM networks when no specific networkId given
      const networkIds = networkId
        ? [networkId]
        : [1, 137, 8453, 42161, 56, 10];

      const fetchForNetwork = async (netId: number) => {
        const url = new URL(
          `https://app.dynamicauth.com/api/v0/sdk/${environmentId}/chains/${chain}/balances`
        );
        url.searchParams.set("accountAddress", agentWallet!.walletAddress);
        url.searchParams.set("includeNative", "true");
        url.searchParams.set("filterSpamTokens", "true");
        url.searchParams.set("networkId", String(netId));
        if (includePrices) url.searchParams.set("includePrices", "true");

        const res = await fetch(url.toString(), { headers });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      };

      const results = await Promise.all(networkIds.map(fetchForNetwork));
      const items = results.flat();

      if (items.length === 0) {
        return JSON.stringify({
          success: true,
          address: agentWallet.walletAddress,
          chain,
          networkId: networkId ?? "all",
          tokens: [],
          message: "No token balances found for this wallet on this chain.",
        });
      }

      return JSON.stringify({
        success: true,
        address: agentWallet.walletAddress,
        chain,
        networkId: networkId ?? "all",
        tokens: items.map((t: any) => ({
          name: t.name,
          symbol: t.symbol,
          balance: t.balance,
          networkId: t.networkId,
          ...(t.price != null && { priceUsd: t.price }),
          ...(t.marketValue != null && { valueUsd: t.marketValue }),
          isNative: t.isNative ?? false,
        })),
      });
    } catch (err) {
      return formatToolError(err);
    }
  },
  {
    name: "get_token_balances",
    description:
      "Get token balances for the agent's delegated wallet across any blockchain using Dynamic's multi-chain API. " +
      "Supports ETH, EVM (any EVM chain), SOL, BTC, COSMOS, SUI, TRON, TON, and more. " +
      "Use networkId to filter to a specific chain (e.g. 137 for Polygon, 1 for Ethereum mainnet, 8453 for Base). " +
      "Pass includePrices=true to get USD values.",
    schema: z.object({
      chainName: z
        .string()
        .optional()
        .describe(
          "Chain type: ETH, EVM, SOL, BTC, COSMOS, SUI, TRON, TON, STELLAR. Defaults to EVM."
        ),
      networkId: z
        .number()
        .optional()
        .describe(
          "Filter to a specific network ID (e.g. 137 = Polygon, 1 = Ethereum, 8453 = Base, 56 = BSC)"
        ),
      includePrices: z
        .boolean()
        .optional()
        .describe("Include USD prices and market values for each token"),
    }),
  }
);

export const allTools = [listWalletsTool, getTokenBalancesTool];
