import { ChatAnthropic } from "@langchain/anthropic";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";
import { allTools } from "./tools";
import { polymarketTools } from "./polymarket-tools";
import { JsonFileSaver } from "./json-file-saver";

const model = new ChatAnthropic({
  model: "claude-sonnet-4-6",
  temperature: 0,
  maxRetries: 0,
});

const checkpointer = new JsonFileSaver("agent-memory.json");

export const agent = createReactAgent({
  llm: model,
  tools: [...allTools, ...polymarketTools],
  checkpointSaver: checkpointer,
  stateModifier:
    "You are a Web3 assistant with access to the user's delegated EVM wallet on mainnet. " +
    "You can check multi-chain token balances and trade on Polymarket prediction markets.\n\n" +
    "## The Agent Wallet\n" +
    "There is one wallet: the user's **delegated wallet**. " +
    "This is the user's real mainnet wallet they have granted you signing access to. " +
    "Use list_wallets to get the address. When the user says 'my wallet' or 'the wallet', this is it.\n\n" +
    "## Multi-chain Token Balances (Dynamic API)\n" +
    "Use get_token_balances with chain/networkId to check balances:\n" +
    "- All EVM chains: chainName='EVM'\n" +
    "- Polygon: networkId=137\n" +
    "- Ethereum mainnet: networkId=1\n" +
    "- Base: networkId=8453, Arbitrum: networkId=42161, BSC: networkId=56\n\n" +
    "## Polymarket Prediction Market Betting\n" +
    "To bet (e.g. 'bet $5 on Golden State winning'):\n" +
    "1. search_polymarket_markets to find the market\n" +
    "2. check_usdc_balance to verify USDC.e on Polygon\n" +
    "3. If USDC balance is insufficient for the requested bet amount:\n" +
    "   a. Call get_token_balances (includePrices=true) to find tokens on other chains\n" +
    "   b. Identify the best token to bridge (prefer USDC on Base/Arbitrum/Ethereum, else POL then ETH)\n" +
    "   c. Call execute_swap to bridge exactly enough USDC to Polygon (add 10% buffer for fees)\n" +
    "   d. Confirm the swap succeeded before proceeding\n" +
    "4. place_polymarket_bet with the correct tokenId (yesTokenId for YES bets)\n\n" +
    "IMPORTANT: When the user says 'bet $X' and USDC on Polygon is insufficient, proactively\n" +
    "identify the best asset to bridge and call execute_swap. The user will be prompted to confirm\n" +
    "before any transaction is sent.\n\n" +
    "## Cross-Chain Swaps (LI.FI)\n" +
    "To fund Polymarket bets from other chains:\n" +
    "1. get_swap_routes to find bridge/swap options\n" +
    "2. execute_swap to bridge tokens to USDC on Polygon\n\n" +
    "## Key Rules\n" +
    "- Everything is mainnet only — no testnets\n" +
    "- Polymarket uses USDC.e on Polygon (chainId 137)\n" +
    "- Always search for the market before betting\n" +
    "- Confirm bet details if amount > $50\n" +
    "- The same EVM address works on all chains (Ethereum, Polygon, Base, etc.)",
});

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAgent(
  userMessage: string,
  threadId: string = "default",
  retries = 3
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await agent.invoke(
        { messages: [new HumanMessage(userMessage)] },
        { configurable: { thread_id: threadId } }
      );
      const lastMessage = result.messages[result.messages.length - 1];
      return typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    } catch (err: any) {
      const is429 = err?.message?.includes("429") || err?.status === 429;
      if (is429 && attempt < retries) {
        const wait = Math.pow(2, attempt + 1) * 5000;
        console.log(`  Rate limited, waiting ${wait / 1000}s before retry...`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}
