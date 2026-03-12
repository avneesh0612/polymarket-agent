/**
 * POST /api/agent
 *
 * Runs the LangGraph agent for the authenticated user.
 *
 * Request body:
 * - message: string — the user's message
 * - threadId?: string — optional thread ID for conversation continuity
 *
 * Response:
 * - { response: string } on success
 * - { error: string } on failure
 *
 * Auth: Bearer JWT (Dynamic auth token)
 *
 * NOTE: The agent uses module-level credential globals (agentWallet, userJWT)
 * which are NOT concurrent-safe. For single-user usage this is fine.
 * Multi-user production deployments should pass credentials through a
 * request-scoped context to avoid credential cross-contamination.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/dynamic-auth";
import { getDelegation } from "@/lib/delegation-store";
import { runAgentForUser } from "@/lib/agent";
import type { DelegationCredentials } from "@/lib/agent";
import type { AuthenticatedUser } from "@/lib/dynamic-auth";

export const POST = withAuth(
  async (
    req: NextRequest,
    { user }: { user: AuthenticatedUser }
  ): Promise<NextResponse> => {
    // Parse request body
    let body: { message?: string; threadId?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { message, threadId } = body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      return NextResponse.json(
        { error: "message is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    // Look up delegation record for this user
    const record = await getDelegation(user.sub);
    if (!record) {
      return NextResponse.json(
        {
          error:
            "No delegation found. Please grant wallet access first from the app.",
        },
        { status: 403 }
      );
    }

    // Build delegation credentials
    const creds: DelegationCredentials = {
      walletId: record.walletId,
      walletAddress: record.address,
      walletApiKey: record.walletApiKey,
      keyShare: record.keyShare,
    };

    // Extract the raw JWT from the Authorization header so the agent can
    // use it when calling the Dynamic balance API
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    // Use the user's sub as the default thread ID for per-user memory continuity
    const effectiveThreadId = threadId ?? user.sub;

    try {
      const response = await runAgentForUser(
        message.trim(),
        effectiveThreadId,
        creds,
        jwt
      );
      return NextResponse.json({ response });
    } catch (err) {
      console.error("[agent] Error running agent:", err);
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);
