import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The project lives under OneDrive, outside the nearest lockfile/git root;
  // pin Turbopack to this folder so dependency detection stays local.
  turbopack: {
    root: path.join(__dirname),
  },
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        // This app renders user-supplied text. Frame-busters and a strict
        // referrer policy cost nothing and close off clickjacking + referrer
        // leakage of transfer URLs (the token rides in the query string).
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
  ],
};

export default nextConfig;
