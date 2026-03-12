/**
 * LI.FI cross-chain swap client.
 *
 * Uses the official @lifi/sdk (v3) to find and execute swap/bridge routes.
 * The SDK handles step transactions, approvals, and confirmation automatically
 * via a viem WalletClient backed by the delegated Dynamic wallet.
 */

import { parseUnits, formatUnits, createWalletClient, http } from "viem";
import { toAccount } from "viem/accounts";
import {
  createConfig,
  EVM,
  getRoutes as sdkGetRoutes,
  executeRoute as sdkExecuteRoute,
  type Route,
} from "@lifi/sdk";
import {
  type DelegationCredentials,
  getChainById,
  signTransactionOnlyDelegated,
  signMessageDelegated,
  signTypedDataDelegated,
} from "./delegated-wallet";

export type LiFiRoute = Route;

export const USDC_ADDRESSES: Record<number, string> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",   // Ethereum
  137: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",  // Polygon (USDC.e)
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
  10: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",   // Optimism
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum
  56: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",   // BSC
};

export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

// ─── LI.FI SDK Initialization ─────────────────────────────────────────────────

let _lifiConfigured = false;

function ensureLiFiSdk(creds: DelegationCredentials): void {
  if (_lifiConfigured) return;

  const buildAccount = () =>
    toAccount({
      address: creds.walletAddress as `0x${string}`,

      async signTransaction(transaction) {
        return signTransactionOnlyDelegated(creds, transaction as any);
      },

      async signMessage({ message }) {
        const msg =
          typeof message === "string"
            ? message
            : Buffer.from((message as { raw: Uint8Array }).raw).toString("utf8");
        return signMessageDelegated(creds, msg);
      },

      async signTypedData({ domain, types, primaryType, message }) {
        const EIP712Domain: { name: string; type: string }[] = [];
        if (domain?.name != null)
          EIP712Domain.push({ name: "name", type: "string" });
        if (domain?.version != null)
          EIP712Domain.push({ name: "version", type: "string" });
        if (domain?.chainId != null)
          EIP712Domain.push({ name: "chainId", type: "uint256" });
        if (domain?.verifyingContract != null)
          EIP712Domain.push({ name: "verifyingContract", type: "address" });
        if (domain?.salt != null)
          EIP712Domain.push({ name: "salt", type: "bytes32" });

        return signTypedDataDelegated(creds, {
          domain,
          types: { EIP712Domain, ...types },
          primaryType: primaryType as string,
          message,
        });
      },
    });

  createConfig({
    integrator: "dynamic-agent",
    providers: [
      EVM({
        getWalletClient: async () =>
          createWalletClient({
            account: buildAccount(),
            chain: getChainById(137),
            transport: http("https://polygon.drpc.org"),
          }),
        switchChain: async (chainId) =>
          createWalletClient({
            account: buildAccount(),
            chain: getChainById(chainId),
            transport: http(),
          }),
      }),
    ],
  });

  _lifiConfigured = true;
}

// ─── Token Discovery ──────────────────────────────────────────────────────────

export interface LiFiToken {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
  chainId: number;
}

export async function findToken(
  chainId: number,
  symbolOrAddress: string
): Promise<LiFiToken | null> {
  const res = await fetch(`https://li.quest/v1/tokens?chainIds=${chainId}`);
  if (!res.ok) return null;
  const data = await res.json();
  const tokens: LiFiToken[] = data.tokens?.[chainId] ?? [];
  const lower = symbolOrAddress.toLowerCase();
  return (
    tokens.find(
      (t) =>
        t.symbol.toLowerCase() === lower || t.address.toLowerCase() === lower
    ) ?? null
  );
}

// ─── Route Fetching ───────────────────────────────────────────────────────────

export interface GetRoutesParams {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string;
  fromAddress: string;
  toAddress?: string;
  slippage?: number;
}

export async function getLiFiRoutes(params: GetRoutesParams): Promise<Route[]> {
  const result = await sdkGetRoutes({
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress ?? params.fromAddress,
    options: {
      order: "RECOMMENDED",
      slippage: params.slippage ?? 0.03,
      allowSwitchChain: true,
    },
  });
  return result.routes ?? [];
}

export async function getRoutesToPolygonUsdc(
  fromChainId: number,
  fromTokenAddress: string,
  amountHuman: string,
  walletAddress: string
): Promise<Route[]> {
  const res = await fetch(
    `https://li.quest/v1/tokens?chainIds=${fromChainId}`
  );
  const data = await res.json();
  const tokens: LiFiToken[] = data.tokens?.[fromChainId] ?? [];
  const fromToken = tokens.find(
    (t) => t.address.toLowerCase() === fromTokenAddress.toLowerCase()
  );
  const decimals = fromToken?.decimals ?? 18;
  const fromAmount = parseUnits(amountHuman, decimals).toString();

  return getLiFiRoutes({
    fromChainId,
    toChainId: 137,
    fromTokenAddress,
    toTokenAddress: USDC_ADDRESSES[137],
    fromAmount,
    fromAddress: walletAddress,
  });
}

// ─── Execute Swap ─────────────────────────────────────────────────────────────

export interface SwapResult {
  success: boolean;
  txHashes: string[];
  receivedAmount?: string;
  receivedToken?: string;
  error?: string;
}

export async function executeLiFiRoute(
  route: Route,
  creds: DelegationCredentials
): Promise<SwapResult> {
  ensureLiFiSdk(creds);

  const txHashes: string[] = [];

  try {
    await sdkExecuteRoute(route, {
      updateRouteHook: (updatedRoute) => {
        for (const step of updatedRoute.steps) {
          for (const process of step.execution?.process ?? []) {
            if (process.txHash && !txHashes.includes(process.txHash)) {
              txHashes.push(process.txHash);
              console.log(`  Tx submitted: ${process.txHash}`);
            }
          }
        }
      },

      updateTransactionRequestHook: async (txRequest) => {
        const gas = txRequest.gas ?? txRequest.gasLimit;
        const adjustedGas = gas
          ? (BigInt(gas as bigint | string) * 250n) / 100n
          : 800_000n;
        return { ...txRequest, gas: adjustedGas, gasLimit: adjustedGas };
      },

      acceptExchangeRateUpdateHook: async () => true,
      infiniteApproval: true,
    });

    const lastStep = route.steps[route.steps.length - 1];
    const receivedAmount = formatUnits(
      BigInt(route.toAmountMin),
      lastStep.action.toToken.decimals
    );

    return {
      success: true,
      txHashes,
      receivedAmount,
      receivedToken: lastStep.action.toToken.symbol,
    };
  } catch (err) {
    return {
      success: false,
      txHashes,
      error: err instanceof Error ? err.message : "Swap execution failed",
    };
  }
}

// ─── Format Helpers ───────────────────────────────────────────────────────────

export function formatRoute(route: Route): object {
  const lastStep = route.steps[route.steps.length - 1];
  const receivedMin = formatUnits(
    BigInt(route.toAmountMin),
    lastStep.action.toToken.decimals
  );
  const received = formatUnits(
    BigInt(route.toAmount),
    lastStep.action.toToken.decimals
  );

  return {
    id: route.id,
    from: `${route.fromToken.symbol} on chain ${route.fromChainId}`,
    to: `${route.toToken.symbol} on chain ${route.toChainId}`,
    youGet: `~${parseFloat(received).toFixed(4)} ${route.toToken.symbol}`,
    minimum: `${parseFloat(receivedMin).toFixed(4)} ${route.toToken.symbol} (min)`,
    gasCostUSD: route.gasCostUSD ? `$${route.gasCostUSD}` : "unknown",
    steps: route.steps.length,
    tags: route.tags ?? [],
  };
}
