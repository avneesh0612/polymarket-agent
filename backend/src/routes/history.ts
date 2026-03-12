import { Hono } from "hono";
import { withAuth } from "../lib/dynamic-auth";
import { getChatHistory } from "../lib/chat-history";

export const historyRoute = new Hono();

historyRoute.get("/", async (c) => {
  const user = await withAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const threadId = c.req.query("threadId") ?? user.sub;
  const messages = await getChatHistory(user.sub, threadId);
  return c.json({ messages });
});
