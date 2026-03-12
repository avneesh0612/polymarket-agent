import { ethers } from "ethers";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import type { UserOrder, UserMarketOrder } from "@polymarket/clob-client";
import {
  type DelegationCredentials,
  signMessageDelegated,
  signTypedDataDelegated,
  sendTransactionDelegated,
} from "./delegated-wallet";

const CLOB_API_URL = "https://clob.polymarket.com";
const POLYGON_CHAIN_ID = 137;
const POLYGON_RPC = "https://polygon.drpc.org";
const SIGNATURE_TYPE_EOA = 0;

// Polymarket contract addresses on Polygon
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const CTF = "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";
const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_CTF_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";

const USDC_SPENDERS = [CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, NEG_RISK_ADAPTER];
const OUTCOME_TOKEN_SPENDERS = [CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, NEG_RISK_ADAPTER];

const MAX_ALLOWANCE = ethers.constants.MaxUint256;
const MIN_ALLOWANCE_THRESHOLD = ethers.BigNumber.from("1000000000000");

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];
const ERC1155_ABI = [
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
];

// CLOB credential cache per wallet address
const credentialsCache = new Map<
  string,
  { key: string; secret: string; passphrase: string }
>();

// ─── DynamicDelegatedSigner ───────────────────────────────────────────────────

/**
 * Ethers v5 Signer backed by Dynamic's delegated signing API.
 * Used when a user has delegated their wallet to the AI agent.
 * Operates on Polygon mainnet for Polymarket trading.
 */
export class DynamicDelegatedSigner extends ethers.Signer {
  private readonly creds: DelegationCredentials;

  constructor(creds: DelegationCredentials) {
    super();
    this.creds = creds;
    ethers.utils.defineReadOnly(
      this,
      "provider",
      new ethers.providers.JsonRpcProvider(POLYGON_RPC, POLYGON_CHAIN_ID)
    );
  }

  async getAddress(): Promise<string> {
    return this.creds.walletAddress;
  }

  async signMessage(message: ethers.Bytes | string): Promise<string> {
    const msgStr =
      typeof message === "string"
        ? message
        : ethers.utils.toUtf8String(message as Uint8Array);
    return signMessageDelegated(this.creds, msgStr);
  }

  async _signTypedData(
    domain: ethers.TypedDataDomain,
    types: Record<string, ethers.TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string> {
    const primaryType =
      Object.keys(types).find((k) => k !== "EIP712Domain") ||
      Object.keys(types)[0];

    const resolvedDomain = {
      ...domain,
      chainId: domain.chainId != null ? Number(domain.chainId) : undefined,
    };

    // Build EIP712Domain types only for fields that are actually present
    const EIP712Domain: { name: string; type: string }[] = [];
    if (resolvedDomain.name != null)
      EIP712Domain.push({ name: "name", type: "string" });
    if (resolvedDomain.version != null)
      EIP712Domain.push({ name: "version", type: "string" });
    if (resolvedDomain.chainId != null)
      EIP712Domain.push({ name: "chainId", type: "uint256" });
    if (resolvedDomain.verifyingContract != null)
      EIP712Domain.push({ name: "verifyingContract", type: "address" });
    if (resolvedDomain.salt != null)
      EIP712Domain.push({ name: "salt", type: "bytes32" });

    const typedData = {
      domain: resolvedDomain,
      types: { EIP712Domain, ...types },
      primaryType,
      message: value,
    };

    return signTypedDataDelegated(this.creds, typedData);
  }

  async signTransaction(
    _tx: ethers.utils.Deferrable<ethers.providers.TransactionRequest>
  ): Promise<string> {
    throw new Error("signTransaction not supported; use sendTransaction");
  }

  async sendTransaction(
    transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>
  ): Promise<ethers.providers.TransactionResponse> {
    const tx = await ethers.utils.resolveProperties(transaction);

    if (!tx.to) {
      throw new Error("sendTransaction requires a 'to' address");
    }

    const txHash = await sendTransactionDelegated(
      this.creds,
      137, // Polygon mainnet for Polymarket
      tx.to as string,
      tx.data as string | undefined,
      tx.value != null ? BigInt(tx.value.toString()) : undefined
    );

    const provider = this.provider as ethers.providers.JsonRpcProvider;
    for (let i = 0; i < 60; i++) {
      const response = await provider.getTransaction(txHash);
      if (response) return response;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Transaction ${txHash} not indexed after 60 seconds`);
  }

  connect(_provider: ethers.providers.Provider): ethers.Signer {
    throw new Error("connect() not supported for DynamicDelegatedSigner");
  }
}

// ─── Market Data ─────────────────────────────────────────────────────────────

export interface PolymarketMarket {
  id: string;
  question: string;
  conditionId: string;
  endDate: string;
  category: string;
  yesPrice: number;
  noPrice: number;
  yesTokenId?: string;
  noTokenId?: string;
  volume: number;
  negRisk: boolean;
}

function parseMarket(m: any): PolymarketMarket {
  let yesTokenId: string | undefined;
  let noTokenId: string | undefined;
  let yesPrice = 0.5;
  let noPrice = 0.5;

  let outcomes: string[] = ["Yes", "No"];
  if (m.outcomes) {
    try {
      outcomes = JSON.parse(m.outcomes) as string[];
    } catch {}
  }
  const lower = outcomes.map((o: string) => o.toLowerCase());
  const yesIdx =
    lower.findIndex((o) => o.includes("yes") || o === "true") >= 0
      ? lower.findIndex((o) => o.includes("yes") || o === "true")
      : 0;
  const noIdx =
    lower.findIndex((o) => o.includes("no") || o === "false") >= 0
      ? lower.findIndex((o) => o.includes("no") || o === "false")
      : 1;

  if (m.clobTokenIds) {
    try {
      const tokenIds = JSON.parse(m.clobTokenIds) as string[];
      yesTokenId = tokenIds[yesIdx] ?? tokenIds[0];
      noTokenId = tokenIds[noIdx] ?? tokenIds[1];
    } catch {}
  }

  if (m.outcomePrices) {
    try {
      const prices = JSON.parse(m.outcomePrices) as string[];
      yesPrice = parseFloat(prices[yesIdx] ?? "0.5");
      noPrice = parseFloat(prices[noIdx] ?? "0.5");
      if (yesPrice + noPrice > 1.5) {
        yesPrice /= 100;
        noPrice /= 100;
      }
    } catch {}
  }

  return {
    id: m.id ?? "",
    question: m.question ?? "",
    conditionId: m.conditionId ?? "",
    endDate: m.endDate ?? "",
    category: m.category ?? "",
    yesPrice,
    noPrice,
    yesTokenId,
    noTokenId,
    volume: m.volumeNum ?? (m.volume ? parseFloat(m.volume) : 0),
    negRisk: m.negRisk ?? false,
  };
}

export async function searchMarkets(
  query: string,
  limit = 10
): Promise<PolymarketMarket[]> {
  const url = new URL("https://gamma-api.polymarket.com/markets");
  url.searchParams.set("limit", "100");
  url.searchParams.set("closed", "false");
  url.searchParams.set("active", "true");

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma API error: ${response.status}`);
  }

  const data = await response.json();
  const markets: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.results)
    ? data.results
    : [];

  const lowerQuery = query.toLowerCase();
  return markets
    .filter((m: any) => m.question?.toLowerCase().includes(lowerQuery))
    .slice(0, limit)
    .map(parseMarket);
}

// ─── USDC Balance ─────────────────────────────────────────────────────────────

export async function getUsdcBalance(walletAddress: string): Promise<number> {
  const provider = new ethers.providers.JsonRpcProvider(
    POLYGON_RPC,
    POLYGON_CHAIN_ID
  );
  const usdc = new ethers.Contract(USDC_E, ERC20_ABI, provider);
  const balance: ethers.BigNumber = await usdc.balanceOf(walletAddress);
  return Number(balance.toString()) / 1e6;
}

// ─── Approvals ────────────────────────────────────────────────────────────────

async function ensureUsdcApprovals(
  signer: ethers.Signer
): Promise<void> {
  const usdc = new ethers.Contract(USDC_E, ERC20_ABI, signer);
  const address = await signer.getAddress();

  for (const spender of USDC_SPENDERS) {
    const allowance: ethers.BigNumber = await usdc.allowance(address, spender);
    if (allowance.lt(MIN_ALLOWANCE_THRESHOLD)) {
      console.log(`  Approving USDC for spender ${spender.slice(0, 10)}...`);
      const tx = await usdc.approve(spender, MAX_ALLOWANCE);
      await tx.wait();
      console.log("  USDC approval confirmed.");
    }
  }
}

async function ensureOutcomeTokenApprovals(
  signer: ethers.Signer
): Promise<void> {
  const ctf = new ethers.Contract(CTF, ERC1155_ABI, signer);
  const address = await signer.getAddress();

  for (const spender of OUTCOME_TOKEN_SPENDERS) {
    const isApproved: boolean = await ctf.isApprovedForAll(address, spender);
    if (!isApproved) {
      console.log(
        `  Approving outcome tokens for spender ${spender.slice(0, 10)}...`
      );
      const tx = await ctf.setApprovalForAll(spender, true);
      await tx.wait();
      console.log("  Outcome token approval confirmed.");
    }
  }
}

// ─── CLOB Credentials ─────────────────────────────────────────────────────────

async function initializeClobCredentials(
  signer: ethers.Signer
): Promise<{ key: string; secret: string; passphrase: string }> {
  const address = await signer.getAddress();

  if (credentialsCache.has(address)) {
    return credentialsCache.get(address)!;
  }

  console.log("  Initializing Polymarket CLOB credentials...");
  const tempClient = new ClobClient(
    CLOB_API_URL,
    POLYGON_CHAIN_ID,
    signer as any
  );

  let credentials: { key: string; secret: string; passphrase: string } | null =
    null;

  try {
    const derived = await tempClient.deriveApiKey();
    if (derived?.key && derived?.secret && derived?.passphrase) {
      credentials = derived;
    }
  } catch {
    // No existing key — create one
  }

  if (!credentials) {
    const created = await tempClient.createApiKey();
    if (!created?.key || !created?.secret || !created?.passphrase) {
      throw new Error("Failed to create Polymarket API credentials");
    }
    credentials = created;
  }

  credentialsCache.set(address, credentials);
  console.log("  CLOB credentials initialized.");
  return credentials;
}

// ─── Place Bet ────────────────────────────────────────────────────────────────

export interface BetParams {
  tokenId: string;
  side: "yes" | "no";
  amount: number;       // USDC amount
  price?: number;       // 0-1 range; omit for market order
  negRisk?: boolean;
}

/**
 * Place a Polymarket bet using the agent's delegated wallet.
 */
export async function placeBet(
  walletAddress: string,
  delegationCreds: DelegationCredentials,
  params: BetParams
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  // Step 1: Check USDC balance
  const balance = await getUsdcBalance(walletAddress);
  if (balance < params.amount) {
    return {
      success: false,
      error: `Insufficient USDC balance. You have ${balance.toFixed(2)} USDC but need ${params.amount} USDC on Polygon.`,
    };
  }

  // Step 2: Build signer
  const signer: ethers.Signer = new DynamicDelegatedSigner(delegationCreds);

  // Step 3: Ensure token approvals
  console.log("  Ensuring USDC and outcome token approvals on Polygon...");
  await ensureUsdcApprovals(signer);
  await ensureOutcomeTokenApprovals(signer);

  // Step 4: Initialize CLOB credentials (signs a message to derive API key)
  const credentials = await initializeClobCredentials(signer);

  // Step 5: Create authenticated CLOB client
  const clobClient = new ClobClient(
    CLOB_API_URL,
    POLYGON_CHAIN_ID,
    signer as any,
    credentials,
    SIGNATURE_TYPE_EOA
  );

  // Step 6: Submit the order
  try {
    const side = Side.BUY; // Always BUY the outcome token (YES or NO)
    let response: any;

    if (!params.price) {
      // Market order (Fill or Kill)
      const order: UserMarketOrder = {
        tokenID: params.tokenId,
        amount: params.amount,
        side,
        feeRateBps: 0,
      };
      response = await clobClient.createAndPostMarketOrder(
        order,
        { negRisk: params.negRisk ?? false },
        OrderType.FOK
      );
    } else {
      // Limit order (Good Till Cancel)
      const size = params.amount / params.price;
      const order: UserOrder = {
        tokenID: params.tokenId,
        price: params.price,
        size,
        side,
        feeRateBps: 0,
        expiration: 0,
        taker: "0x0000000000000000000000000000000000000000",
      };
      response = await clobClient.createAndPostOrder(
        order,
        { negRisk: params.negRisk ?? false },
        OrderType.GTC
      );
    }

    const orderId =
      response.orderID ||
      response.orderId ||
      response.order_id ||
      response.id;

    if (orderId) {
      return { success: true, orderId };
    } else if (response.success || response.status === "success") {
      return { success: true, orderId: "pending" };
    } else if (response.error || response.message) {
      throw new Error(response.error || response.message);
    } else {
      throw new Error(`Unexpected response: ${JSON.stringify(response)}`);
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to place order",
    };
  }
}

// ─── User Positions ────────────────────────────────────────────────────────────

export interface UserPosition {
  market: string;
  outcome: string;
  size: number;
  avgPrice: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
}

export async function getUserPositions(
  walletAddress: string
): Promise<UserPosition[]> {
  const url = `https://data-api.polymarket.com/positions?user=${walletAddress.toLowerCase()}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Polymarket Data API error: ${response.status}`);
  }
  const data = await response.json();
  const positions: any[] = Array.isArray(data) ? data : (data.data ?? []);

  return positions.map((p: any) => ({
    market: p.title ?? p.market ?? "Unknown",
    outcome: p.outcome ?? "Unknown",
    size: p.size ?? 0,
    avgPrice: p.avgPrice ?? 0,
    currentValue: p.currentValue ?? p.value ?? 0,
    pnl: p.cashPnl ?? p.pnl ?? 0,
    pnlPercent: p.percentPnl ?? 0,
  }));
}
