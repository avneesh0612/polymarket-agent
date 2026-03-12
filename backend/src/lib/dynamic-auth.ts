import jwt, { type JwtPayload } from "jsonwebtoken";
import { JwksClient } from "jwks-rsa";
import type { Context } from "hono";

export type JwtVerifiedCredential = {
  id: string;
  address: string;
  chain: string;
  format: string;
  wallet_name: string;
  wallet_provider: string;
};

export interface DynamicJwtPayload extends JwtPayload {
  sub: string;
  environment_id: string;
  verified_credentials: JwtVerifiedCredential[];
  email: string;
}

export type AuthenticatedUser = DynamicJwtPayload;

const DYNAMIC_ENV_ID = process.env.DYNAMIC_ENVIRONMENT_ID;
const JWKS_URL = `https://app.dynamic.xyz/api/v0/sdk/${DYNAMIC_ENV_ID}/.well-known/jwks`;

const client = new JwksClient({
  jwksUri: JWKS_URL,
  rateLimit: true,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000,
});

export async function verifyDynamicJWT(token: string): Promise<DynamicJwtPayload | null> {
  try {
    const signingKey = await client.getSigningKey();
    const publicKey = signingKey.getPublicKey();
    return jwt.verify(token, publicKey) as DynamicJwtPayload;
  } catch (error) {
    console.error("JWT verification failed:", error);
    return null;
  }
}

export async function withAuth(c: Context): Promise<AuthenticatedUser | null> {
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  return verifyDynamicJWT(token);
}
