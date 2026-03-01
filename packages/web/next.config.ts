import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow server components to fetch from the FastAPI backend on the local network
  experimental: {},
};

export default nextConfig;
