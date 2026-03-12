import { Hono } from "hono";
import { withAuth } from "../lib/dynamic-auth";
import { getDelegation } from "../lib/delegation-store";
import { runAgentForUser } from "../lib/agent";
import type { DelegationCredentials } from "../lib/agent";

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
    return c.json({ response });
  } catch (err) {
    console.error("[agent] Error:", err);
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return c.json({ error: msg }, 500);
  }
});
