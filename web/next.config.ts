import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@dynamic-labs-wallet/node-evm",
    "@dynamic-labs-wallet/node",
    "@polymarket/clob-client",
    "@lifi/sdk",
    "ethers",
  ],
};

export default nextConfig;
