/**
 * Web agent runner.
 *
 * Creates a LangGraph ReAct agent and runs it for a specific user,
 * using that user's delegated wallet credentials.
 *
 * NOTE: setAgentWallet / setUserJWT are module-level globals — NOT concurrent-safe.
 * For single-user scenarios this is fine. For production multi-user deployments,
 * refactor to pass credentials through a request-scoped context.
 */

import { ChatAnthropic } from "@langchain/anthropic";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";
import { allTools } from "./tools";
import { polymarketTools } from "./polymarket-tools";
import { SupabaseSaver } from "../supabase-saver";
import {
  setAgentWallet,
  setUserJWT,
  type DelegationCredentials,
} from "./credentials";

export type { DelegationCredentials };

const model = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  temperature: 0,
  maxRetries: 0,
});

const checkpointer = new SupabaseSaver();

const SYSTEM_PROMPT = `\
You are a concise, knowledgeable Web3 assistant with access to the user's delegated EVM wallet on mainnet.

## Response style
- Be direct and conversational. No unnecessary preamble or filler phrases.
- Lead with the answer, then supporting detail. Never start with "Certainly!" or similar.
- For lists of balances or markets, use plain line-by-line format (no markdown headers or bold) so it reads naturally on mobile.
- Keep responses short unless the user explicitly asks for detail.
- When a transaction completes, confirm with one clear sentence: what was done, the amount, and the chain.
- If something fails, say exactly what failed and what the user can do about it.

## The wallet
There is one wallet: the user's delegated wallet. Use list_wallets to get the address.
"My wallet", "the wallet" — both refer to this.

## Token balances
Use get_token_balances with:
- All EVM chains: chainName='EVM'
- Polygon: networkId=137 | Ethereum: networkId=1
- Base: networkId=8453 | Arbitrum: networkId=42161 | BSC: networkId=56

## Polymarket bets
1. search_polymarket_markets — find the market
2. check_usdc_balance — verify USDC.e on Polygon (chainId 137)
3. If USDC insufficient:
   a. get_token_balances (includePrices=true) — find best asset to bridge
   b. Prefer USDC on Base/Arbitrum/Ethereum, then POL, then ETH
   c. execute_swap — bridge exactly enough + 10% buffer to Polygon
   d. Confirm swap success before continuing
4. place_polymarket_bet — use yesTokenId for YES bets

## Cross-chain swaps (LI.FI)
1. get_swap_routes — find bridge options
2. execute_swap — execute the bridge

## Rules
- Mainnet only, no testnets
- Amount > $50: ask the user to confirm before placing
- Same EVM address works across all chains`;

const agent = createReactAgent({
  llm: model,
  tools: [...allTools, ...polymarketTools],
  checkpointSaver: checkpointer,
  stateModifier: SYSTEM_PROMPT,
});

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the agent for a specific user with their delegation credentials.
 *
 * Sets the global agentWallet and userJWT before invoking the agent,
 * then restores them after. The thread ID enables conversation persistence
 * across multiple API calls.
 */
const AGENT_TIMEOUT_MS = 120_000; // 2 minutes

export async function runAgentForUser(
  message: string,
  threadId: string,
  creds: DelegationCredentials,
  jwt: string,
  retries = 3
): Promise<string> {
  // Set per-user credentials (NOT concurrent-safe — see module note)
  setAgentWallet(creds);
  setUserJWT(jwt);

  for (let attempt = 0; attempt <= retries; attempt++) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("AGENT_TIMEOUT")),
          AGENT_TIMEOUT_MS
        );
      });

      const invokePromise = agent.invoke(
        { messages: [new HumanMessage(message)] },
        { configurable: { thread_id: threadId } }
      );

      const result = await Promise.race([invokePromise, timeoutPromise]);
      const lastMessage = result.messages[result.messages.length - 1];
      return typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    } catch (err: any) {
      if (err?.message === "AGENT_TIMEOUT") throw err;
      const is429 = err?.message?.includes("429") || err?.status === 429;
      if (is429 && attempt < retries) {
        const wait = Math.pow(2, attempt + 1) * 5000;
        console.log(`  Rate limited, waiting ${wait / 1000}s before retry...`);
        await sleep(wait);
        continue;
      }
      throw err;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
  throw new Error("Unreachable");
}
