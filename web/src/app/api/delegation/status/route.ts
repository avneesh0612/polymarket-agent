/**
 * GET /api/delegation/status
 *
 * Returns the delegation status for the authenticated user.
 *
 * Response:
 * - { delegated: false } if no delegation record exists
 * - { delegated: true, address: string } if delegation is active
 *
 * Auth: Bearer JWT (Dynamic auth token)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/dynamic-auth";
import { getDelegation } from "@/lib/delegation-store";
import type { AuthenticatedUser } from "@/lib/dynamic-auth";

export const GET = withAuth(
  async (
    _req: NextRequest,
    { user }: { user: AuthenticatedUser }
  ): Promise<NextResponse> => {
    const record = await getDelegation(user.sub);

    if (!record) {
      return NextResponse.json({ delegated: false });
    }

    return NextResponse.json({
      delegated: true,
      address: record.address,
      chain: record.chain,
    });
  }
);
