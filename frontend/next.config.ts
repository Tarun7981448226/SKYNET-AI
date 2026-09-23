import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-only route indicator ("N" badge, bottom-left) is a build/dev
  // tool with no end-user purpose here — turned off so the desktop stays
  // visually clean (Next.js still surfaces real compile/runtime errors).
  devIndicators: false,
};

export default nextConfig;
