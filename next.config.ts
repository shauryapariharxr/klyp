import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The project lives under OneDrive, outside the nearest lockfile/git root;
  // pin Turbopack to this folder so dependency detection stays local.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
