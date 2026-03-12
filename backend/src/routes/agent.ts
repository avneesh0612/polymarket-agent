import { Hono } from "hono";
import { withAuth } from "../lib/dynamic-auth";
import { getDelegation } from "../lib/delegation-store";
import { runAgentForUser } from "../lib/agent";
import type { DelegationCredentials } from "../lib/agent";
import { saveChatMessage } from "../lib/chat-history";

export const agentRoute = new Hono();

agentRoute.post("/", async (c) => {
  const user = await withAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  let body: { message?: string; threadId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { message, threadId } = body;
  if (!message || typeof message !== "string" || message.trim() === "") {
    return c.json({ error: "message is required" }, 400);
  }

  const record = await getDelegation(user.sub);
  if (!record) {
    return c.json({ error: "No delegation found. Please grant wallet access first." }, 403);
  }

  const creds: DelegationCredentials = {
    walletId: record.walletId,
    walletAddress: record.address,
    walletApiKey: record.walletApiKey,
    keyShare: record.keyShare,
  };

  const authHeader = c.req.header("authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  const effectiveThreadId = threadId ?? user.sub;

  try {
    const response = await runAgentForUser(message.trim(), effectiveThreadId, creds, jwt);
    await saveChatMessage(user.sub, effectiveThreadId, "user", message.trim());
    await saveChatMessage(user.sub, effectiveThreadId, "assistant", response);
    return c.json({ response });
  } catch (err: any) {
    console.error("[agent] Error:", err);
    const raw = err?.message ?? "";

    if (raw === "AGENT_TIMEOUT") {
      return c.json({ error: "The agent took too long to respond. Please try again." }, 504);
    }
    if (raw.includes("429") || err?.status === 429) {
      return c.json({ error: "Service is busy right now. Please wait a moment and try again." }, 429);
    }
    if (raw.includes("ECONNREFUSED") || raw.includes("ENOTFOUND") || raw.includes("fetch failed")) {
      return c.json({ error: "Could not reach a downstream service. Please try again." }, 503);
    }
    return c.json({ error: "Something went wrong. Please try again." }, 500);
  }
});
