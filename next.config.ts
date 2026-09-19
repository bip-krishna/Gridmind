import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: __dirname,
  experimental: {
    serverActions: {},
  },
};

export default nextConfig;