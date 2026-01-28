import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['drizzle-orm', 'drizzle-kit'],
  experimental: {
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();