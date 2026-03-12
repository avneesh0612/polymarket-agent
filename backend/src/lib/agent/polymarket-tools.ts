/**
 * Polymarket and LI.FI tools for the web agent.
 * Web version — uses credentials from the credentials module.
 *
 * The confirm() function in this version auto-approves all transactions since
 * the user is interacting through the chat UI. Transactions > $50 will include
 * a note in the agent response, but are still executed (the chat UI is the
 * confirmation mechanism).
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  searchMarkets,
  getUsdcBalance,
  placeBet,
  getUserPositions,
} from "./polymarket-client";
import {
  getLiFiRoutes,
  executeLiFiRoute,
  findToken,
  formatRoute,
  NATIVE_TOKEN,
  USDC_ADDRESSES,
} from "./lifi-client";
import { agentWallet } from "./credentials";
import { appendFileSync } from "fs";
import path from "path";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatError(err: unknown): string {
  return JSON.stringify({
    success: false,
    error: err instanceof Error ? err.message : String(err),
  });
}

function getWallet() {
  if (!agentWallet) return null;
  return { address: agentWallet.walletAddress, creds: agentWallet };
}

// Audit log for all tool executions
const AUDIT_FILE = path.join(process.cwd(), "audit.log");

function auditLog(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    appendFileSync(AUDIT_FILE, line + "\n");
  } catch {
    // Never crash the agent over a logging failure
  }
}

// ─── Polymarket Tools ─────────────────────────────────────────────────────────

export const searchPolymarketMarketsTool = tool(
  async ({ query, limit }) => {
    try {
      const markets = await searchMarkets(query, limit ?? 10);
      if (markets.length === 0) {
        return JSON.stringify({
          markets: [],
          message: `No active markets found matching "${query}". Try a different search term.`,
        });
      }
      return JSON.stringify({
        markets: markets.map((m) => ({
          id: m.id,
          question: m.question,
          yesPrice: `${(m.yesPrice * 100).toFixed(1)}%`,
          noPrice: `${(m.noPrice * 100).toFixed(1)}%`,
          yesTokenId: m.yesTokenId,
          noTokenId: m.noTokenId,
          conditionId: m.conditionId,
          endDate: m.endDate,
          volume: `$${m.volume.toLocaleString()}`,
          negRisk: m.negRisk,
          category: m.category,
        })),
        count: markets.length,
      });
    } catch (err) {
      return formatError(err);
    }
  },
  {
    name: "search_polymarket_markets",
    description:
      "Search for active prediction markets on Polymarket by keyword. " +
      "Returns markets with current yes/no prices and token IDs needed for betting. " +
      "Use this before placing a bet to find the right market and token ID.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "Search term, e.g. 'golden state warriors', 'bitcoin price', 'election'"
        ),
      limit: z
        .number()
        .optional()
        .describe("Max number of results to return (default: 10)"),
    }),
  }
);

export const checkUsdcBalanceTool = tool(
  async () => {
    try {
      const wallet = getWallet();
      if (!wallet) {
        return JSON.stringify({ success: false, error: "No agent wallet loaded." });
      }
      const balance = await getUsdcBalance(wallet.address);
      return JSON.stringify({
        success: true,
        address: wallet.address,
        usdcBalance: balance.toFixed(4),
        unit: "USDC.e",
        network: "Polygon Mainnet (chainId: 137)",
        note:
          balance < 1
            ? "Low balance. Fund this address with USDC.e on Polygon, or use the execute_swap tool to bridge USDC from another chain."
            : undefined,
      });
    } catch (err) {
      return formatError(err);
    }
  },
  {
    name: "check_usdc_balance",
    description:
      "Check the USDC.e balance on Polygon mainnet for the agent wallet. Required before placing Polymarket bets.",
    schema: z.object({}),
  }
);

export const placePolymarketBetTool = tool(
  async ({ tokenId, side, amount, price, negRisk }) => {
    try {
      const wallet = getWallet();
      if (!wallet) {
        return JSON.stringify({ success: false, error: "No agent wallet loaded." });
      }

      auditLog({
        tool: "place_polymarket_bet",
        action: "executing",
        input: { tokenId, side, amount, price, negRisk },
      });

      console.log(
        `\nPlacing Polymarket bet: $${amount} on ${side.toUpperCase()} (token: ${tokenId.slice(0, 16)}...)`
      );

      const result = await placeBet(wallet.address, wallet.creds, {
        tokenId,
        side,
        amount,
        price: price ?? undefined,
        negRisk: negRisk ?? false,
      });

      auditLog({
        tool: "place_polymarket_bet",
        action: "executed",
        input: { tokenId, side, amount },
        result: result.success
          ? { orderId: result.orderId }
          : { error: result.error },
      });

      if (result.success) {
        return JSON.stringify({
          success: true,
          orderId: result.orderId,
          message: `Successfully placed $${amount} USDC bet on ${side.toUpperCase()}. Order ID: ${result.orderId}`,
          walletAddress: wallet.address,
          network: "Polygon",
        });
      } else {
        return JSON.stringify({ success: false, error: result.error });
      }
    } catch (err) {
      return formatError(err);
    }
  },
  {
    name: "place_polymarket_bet",
    description:
      "Place a prediction market bet on Polymarket (Polygon mainnet). " +
      "Automatically handles USDC token approvals and order submission. " +
      "Use search_polymarket_markets first to get the tokenId. " +
      "Pass yesTokenId to bet YES (outcome happens) or noTokenId to bet NO.",
    schema: z.object({
      tokenId: z
        .string()
        .describe("Outcome token ID from search results (yesTokenId or noTokenId)"),
      side: z.enum(["yes", "no"]).describe("Buy YES or NO shares"),
      amount: z.number().describe("USDC amount to bet (e.g. 5 for $5)"),
      price: z
        .number()
        .optional()
        .describe("Price per share (0-1). Omit for market order."),
      negRisk: z
        .boolean()
        .optional()
        .describe("Whether this is a neg-risk market (from search results)"),
    }),
  }
);

export const getPolymarketPositionsTool = tool(
  async () => {
    try {
      const wallet = getWallet();
      if (!wallet) {
        return JSON.stringify({ success: false, error: "No agent wallet loaded." });
      }
      const positions = await getUserPositions(wallet.address);
      if (positions.length === 0) {
        return JSON.stringify({
          positions: [],
          message: "No open Polymarket positions found.",
          address: wallet.address,
        });
      }
      return JSON.stringify({
        positions: positions.map((p) => ({
          market: p.market,
          outcome: p.outcome,
          shares: p.size.toFixed(4),
          avgPrice: `${(p.avgPrice * 100).toFixed(1)}%`,
          currentValue: `$${p.currentValue.toFixed(2)}`,
          pnl: `${p.pnl >= 0 ? "+" : ""}$${p.pnl.toFixed(2)}`,
          pnlPercent: `${p.pnlPercent >= 0 ? "+" : ""}${p.pnlPercent.toFixed(1)}%`,
        })),
        count: positions.length,
        address: wallet.address,
      });
    } catch (err) {
      return formatError(err);
    }
  },
  {
    name: "get_polymarket_positions",
    description:
      "Get current Polymarket prediction market positions (bets) for the agent wallet, including P&L.",
    schema: z.object({}),
  }
);

// ─── LI.FI Cross-Chain Swap Tools ─────────────────────────────────────────────

export const getSwapRoutesTool = tool(
  async ({ fromChainId, fromToken, amount, toChainId, toToken }) => {
    try {
      const wallet = getWallet();
      if (!wallet) {
        return JSON.stringify({ success: false, error: "No agent wallet loaded." });
      }

      const destChain = toChainId ?? 137;

      let fromTokenAddress = fromToken;
      if (!fromToken.startsWith("0x")) {
        if (fromToken.toLowerCase() === "eth" || fromToken.toLowerCase() === "native") {
          fromTokenAddress = NATIVE_TOKEN;
        } else {
          const found = await findToken(fromChainId, fromToken);
          if (!found) {
            return JSON.stringify({
              success: false,
              error: `Token "${fromToken}" not found on chain ${fromChainId}`,
            });
          }
          fromTokenAddress = found.address;
        }
      }

      let toTokenAddress = toToken;
      if (!toTokenAddress) {
        toTokenAddress = USDC_ADDRESSES[destChain] ?? USDC_ADDRESSES[137];
      } else if (!toTokenAddress.startsWith("0x")) {
        if (toTokenAddress.toLowerCase() === "eth" || toTokenAddress.toLowerCase() === "native") {
          toTokenAddress = NATIVE_TOKEN;
        } else {
          const found = await findToken(destChain, toTokenAddress);
          if (!found) {
            return JSON.stringify({
              success: false,
              error: `Destination token "${toTokenAddress}" not found on chain ${destChain}`,
            });
          }
          toTokenAddress = found.address;
        }
      }

      const fromTokenInfo =
        fromTokenAddress !== NATIVE_TOKEN
          ? await findToken(fromChainId, fromTokenAddress)
          : null;
      const decimals = fromTokenInfo?.decimals ?? 18;
      const { parseUnits } = await import("viem");
      const fromAmount = parseUnits(amount.toString(), decimals).toString();

      const routes = await getLiFiRoutes({
        fromChainId,
        toChainId: destChain,
        fromTokenAddress,
        toTokenAddress,
        fromAmount,
        fromAddress: wallet.address,
      });

      if (routes.length === 0) {
        return JSON.stringify({
          success: true,
          routes: [],
          message: `No swap routes found from chain ${fromChainId} to chain ${destChain}. Try a different token or amount.`,
        });
      }

      return JSON.stringify({
        success: true,
        walletAddress: wallet.address,
        routes: routes.slice(0, 3).map(formatRoute),
        bestRouteId: routes[0].id,
        count: routes.length,
      });
    } catch (err) {
      return formatError(err);
    }
  },
  {
    name: "get_swap_routes",
    description:
      "Find swap/bridge routes for any token on any chain using LI.FI. " +
      "Supports same-chain swaps (e.g. POL → USDC.e on Polygon, USDC → ETH on Base) " +
      "and cross-chain bridges (e.g. ETH on Base → USDC.e on Polygon). " +
      "Defaults to USDC.e on Polygon when toChainId/toToken are omitted.",
    schema: z.object({
      fromChainId: z
        .number()
        .describe("Source chain ID (e.g. 1 = Ethereum, 8453 = Base, 137 = Polygon)"),
      fromToken: z
        .string()
        .describe(
          "Token to swap from — symbol (e.g. 'ETH', 'POL', 'USDC') or contract address (0x...)"
        ),
      amount: z
        .number()
        .describe("Amount to swap in human-readable units (e.g. 0.1 for 0.1 ETH)"),
      toChainId: z
        .number()
        .optional()
        .describe(
          "Destination chain ID (default: 137 = Polygon). Set same as fromChainId for same-chain swaps."
        ),
      toToken: z
        .string()
        .optional()
        .describe("Destination token — symbol or address (default: USDC.e on Polygon)"),
    }),
  }
);

export const executeSwapTool = tool(
  async ({ routeId, fromChainId, fromToken, amount, toChainId, toToken }) => {
    try {
      const wallet = getWallet();
      if (!wallet) {
        return JSON.stringify({ success: false, error: "No agent wallet loaded." });
      }

      const destChain = toChainId ?? 137;

      let fromTokenAddress = fromToken;
      if (!fromToken.startsWith("0x")) {
        if (fromToken.toLowerCase() === "eth" || fromToken.toLowerCase() === "native") {
          fromTokenAddress = NATIVE_TOKEN;
        } else {
          const found = await findToken(fromChainId, fromToken);
          if (!found) {
            return JSON.stringify({
              success: false,
              error: `Token "${fromToken}" not found on chain ${fromChainId}`,
            });
          }
          fromTokenAddress = found.address;
        }
      }

      let toTokenAddress = toToken;
      if (!toTokenAddress) {
        toTokenAddress = USDC_ADDRESSES[destChain] ?? USDC_ADDRESSES[137];
      } else if (!toTokenAddress.startsWith("0x")) {
        if (toTokenAddress.toLowerCase() === "eth" || toTokenAddress.toLowerCase() === "native") {
          toTokenAddress = NATIVE_TOKEN;
        } else {
          const found = await findToken(destChain, toTokenAddress);
          if (!found) {
            return JSON.stringify({
              success: false,
              error: `Destination token "${toTokenAddress}" not found on chain ${destChain}`,
            });
          }
          toTokenAddress = found.address;
        }
      }

      const fromTokenInfo =
        fromTokenAddress !== NATIVE_TOKEN
          ? await findToken(fromChainId, fromTokenAddress)
          : null;
      const decimals = fromTokenInfo?.decimals ?? 18;
      const { parseUnits } = await import("viem");
      const fromAmount = parseUnits(amount.toString(), decimals).toString();

      console.log(`\nFetching swap routes for execution...`);
      const routes = await getLiFiRoutes({
        fromChainId,
        toChainId: destChain,
        fromTokenAddress,
        toTokenAddress,
        fromAmount,
        fromAddress: wallet.address,
      });

      if (routes.length === 0) {
        return JSON.stringify({ success: false, error: "No swap routes available" });
      }

      const route = routeId
        ? routes.find((r) => r.id === routeId) ?? routes[0]
        : routes[0];

      const CHAIN_NAMES: Record<number, string> = {
        1: "Ethereum",
        137: "Polygon",
        8453: "Base",
        42161: "Arbitrum",
        56: "BSC",
        10: "Optimism",
      };
      const fromChainName = CHAIN_NAMES[fromChainId] ?? `chain ${fromChainId}`;
      const toChainName = CHAIN_NAMES[destChain] ?? `chain ${destChain}`;

      auditLog({
        tool: "execute_swap",
        action: "executing",
        input: { fromChainId, fromToken, amount, toChainId: destChain, toToken },
        routeId: route.id,
        from: `${amount} ${route.fromToken.symbol} on ${fromChainName}`,
        to: `${route.toToken.symbol} on ${toChainName}`,
      });

      console.log(
        `Executing swap: ${route.fromToken.symbol} → ${route.toToken.symbol} via ${route.steps.length} step(s)`
      );

      const result = await executeLiFiRoute(route, wallet.creds);

      auditLog({
        tool: "execute_swap",
        action: "executed",
        input: { fromChainId, fromToken, amount, toChainId: destChain },
        result: result.success
          ? {
              txHashes: result.txHashes,
              received: `${result.receivedAmount} ${result.receivedToken}`,
            }
          : { error: result.error, txHashes: result.txHashes },
      });

      if (result.success) {
        return JSON.stringify({
          success: true,
          txHashes: result.txHashes,
          received: `~${result.receivedAmount} ${result.receivedToken}`,
          message: `Swap complete! Received ~${result.receivedAmount} ${result.receivedToken} on chain ${destChain}.`,
        });
      } else {
        return JSON.stringify({
          success: false,
          error: result.error,
          txHashes: result.txHashes,
        });
      }
    } catch (err) {
      return formatError(err);
    }
  },
  {
    name: "execute_swap",
    description:
      "Execute a token swap or bridge using LI.FI. Supports same-chain swaps and cross-chain bridges. " +
      "Use get_swap_routes first to see available routes, then call this to execute.",
    schema: z.object({
      fromChainId: z
        .number()
        .describe("Source chain ID (1 = Ethereum, 8453 = Base, 56 = BSC, etc.)"),
      fromToken: z
        .string()
        .describe("Token to swap from — symbol (e.g. 'ETH') or contract address"),
      amount: z
        .number()
        .describe("Amount to swap in human-readable units (e.g. 0.1 for 0.1 ETH)"),
      routeId: z
        .string()
        .optional()
        .describe(
          "Specific route ID from get_swap_routes. Uses best route if not provided."
        ),
      toChainId: z
        .number()
        .optional()
        .describe("Destination chain ID (default: 137 = Polygon)"),
      toToken: z
        .string()
        .optional()
        .describe("Destination token address (default: USDC.e on Polygon)"),
    }),
  }
);

export const polymarketTools = [
  searchPolymarketMarketsTool,
  checkUsdcBalanceTool,
  placePolymarketBetTool,
  getPolymarketPositionsTool,
  getSwapRoutesTool,
  executeSwapTool,
];
