import type { NextConfig } from "next";

// cacheComponents is intentionally OFF: every route here serves live market or
// account data and must never be prerendered or cached by Next.
const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
