import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin Turbopack root to this directory; otherwise Next can pick a parent
  // lockfile (e.g. ~/ComSci/Workspace/package-lock.json) and miss routes.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
