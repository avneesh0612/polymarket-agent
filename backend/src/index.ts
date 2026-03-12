import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { agentRoute } from "./routes/agent";
import { delegationRoute } from "./routes/delegation";
import { webhooksRoute } from "./routes/webhooks";
import { voiceRoute } from "./routes/voice";
import { historyRoute } from "./routes/history";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*", // tighten for production
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "agent-backend" }));

// Routes
app.route("/api/agent", agentRoute);
app.route("/api/delegation", delegationRoute);
app.route("/api/webhooks", webhooksRoute);
app.route("/api/voice", voiceRoute);
app.route("/api/history", historyRoute);

const port = parseInt(process.env.PORT ?? "3001");
console.log(`Backend server running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
