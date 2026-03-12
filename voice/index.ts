import readline from "readline";
import { loadDelegationCredentials } from "../delegated-wallet";
import { setAgentWallet } from "../tools";
import { runAgent } from "../agent";
import { setReadlineForConfirm, auditLog } from "../confirm";
import { TextToSpeech } from "./tts";
import { SpeechToText } from "./stt";

// ─── Validate env ─────────────────────────────────────────────────────────────

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
if (!ELEVENLABS_API_KEY) {
  console.error("Missing ELEVENLABS_API_KEY in environment.");
  process.exit(1);
}

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

// ─── Voice setup ─────────────────────────────────────────────────────────────

const tts = new TextToSpeech(ELEVENLABS_API_KEY);
const stt = new SpeechToText(ELEVENLABS_API_KEY);
const THREAD_ID = "voice-session";

// ─── REPL ────────────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

setReadlineForConfirm(rl);

console.log("=".repeat(60));
console.log("  Web3 + Polymarket AI Agent  [Voice Mode]");
console.log("=".repeat(60));
console.log("Press Enter to start speaking. Silence stops recording.");
console.log("Type 'text' to switch to text input, 'exit' to quit.\n");

function ask(q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

rl.on("close", () => {
  console.log("\nGoodbye!");
  process.exit(0);
});

async function voiceLoop() {
  let textMode = false;

  while (true) {
    let userInput: string;

    if (textMode) {
      userInput = (await ask("You (text): ")).trim();
      if (userInput.toLowerCase() === "voice") {
        textMode = false;
        console.log("Switched to voice mode.\n");
        continue;
      }
    } else {
      const key = await ask("[ Press Enter to speak, or type 'text' ] ");
      if (key.trim().toLowerCase() === "text") {
        textMode = true;
        console.log("Switched to text mode. Type 'voice' to go back.\n");
        continue;
      }
      console.log("Listening... (speak now, recording stops after silence)\n");
      userInput = await stt.recordAndTranscribe();
      if (!userInput) {
        console.log("(nothing heard, try again)\n");
        continue;
      }
      console.log(`You: ${userInput}`);
    }

    if (!userInput) continue;

    if (["exit", "quit"].includes(userInput.toLowerCase())) {
      rl.close();
      break;
    }

    auditLog({ event: "user_message", message: userInput, threadId: THREAD_ID, mode: textMode ? "text" : "voice" });

    try {
      console.log("Thinking...\n");
      const response = await runAgent(userInput, THREAD_ID);
      auditLog({ event: "agent_response", preview: response.slice(0, 200) });
      console.log(`Agent: ${response}\n`);

      if (!textMode) {
        console.log("Speaking...");
        await tts.speak(response);
        console.log();
      }
    } catch (err: any) {
      auditLog({ event: "error", error: err?.message ?? String(err) });
      console.error(`Error: ${err?.message ?? String(err)}\n`);
    }
  }
}

voiceLoop();
