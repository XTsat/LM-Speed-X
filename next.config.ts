import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.5.56", "192.168.5.57", "localhost"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "unavatar.io"
      },
    ],
  },
  turbopack: {
    root: __dirname,
  },
};

export default withNextIntl(nextConfig);