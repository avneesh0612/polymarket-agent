import { Hono } from "hono";
import { withAuth } from "../lib/dynamic-auth";
import { getDelegation } from "../lib/delegation-store";

export const delegationRoute = new Hono();

delegationRoute.get("/status", async (c) => {
  const user = await withAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const record = await getDelegation(user.sub);
  if (!record) return c.json({ delegated: false });

  return c.json({ delegated: true, address: record.address, chain: record.chain });
});
