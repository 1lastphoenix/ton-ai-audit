import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ton-audit/shared"],
  experimental: {
    authInterrupts: true
  }
};

export default nextConfig;