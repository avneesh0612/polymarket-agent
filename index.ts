import readline from "readline";
import { loadDelegationCredentials } from "./delegated-wallet";
import { setAgentWallet } from "./tools";
import { runAgent } from "./agent";

// ─── Load Delegated Agent Wallet ─────────────────────────────────────────────

const delegationCreds = loadDelegationCredentials();
if (delegationCreds) {
  setAgentWallet(delegationCreds);
  console.log(`Agent wallet loaded: ${delegationCreds.walletAddress}\n`);
} else {
  console.error(
    "No delegation credentials found. Set DELEGATED_WALLET_ID, " +
      "DELEGATED_WALLET_ADDRESS, and either pre-decrypted or encrypted " +
      "credentials in your .env to use the agent wallet."
  );
  process.exit(1);
}

// ─── Interactive REPL ─────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("  Web3 + Polymarket AI Agent");
console.log("=".repeat(60));
console.log("Example commands:");
console.log('  "show my wallet"');
console.log('  "check my USDC balance on polygon"');
console.log('  "bet $5 on golden state warriors winning"');
console.log('  "show my polymarket positions"');
console.log('  "swap 0.01 ETH from ethereum to USDC on polygon"');
console.log('  "show all my token balances including prices"');
console.log("  Type 'exit' to quit\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const threadId = "interactive-session";

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

rl.on("close", () => {
  console.log("\nGoodbye!");
  process.exit(0);
});

while (true) {
  const userInput = (await prompt("You: ")).trim();
  if (!userInput) continue;
  if (
    userInput.toLowerCase() === "exit" ||
    userInput.toLowerCase() === "quit"
  ) {
    rl.close();
    break;
  }

  try {
    const response = await runAgent(userInput, threadId);
    console.log(`\nAgent: ${response}\n`);
  } catch (err: any) {
    console.error(`\nError: ${err?.message ?? String(err)}\n`);
  }
}
