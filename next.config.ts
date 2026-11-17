import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "node-pty"],
  outputFileTracingRoot: __dirname,
  experimental: {
    serverActions: {},
  },
};

export default nextConfig;
