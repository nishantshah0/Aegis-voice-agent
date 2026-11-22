import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The console and the stage moved into the signed-in dashboard. Old links, DEMO.md and
  // bookmarks keep working. Exact pages only: /api/* and /console/review/labels stay put.
  async redirects() {
    return [
      { source: "/console", destination: "/dashboard/calls", permanent: false },
      { source: "/console/today", destination: "/dashboard/calls", permanent: false },
      { source: "/console/upcoming", destination: "/dashboard/calls/upcoming", permanent: false },
      { source: "/console/calls", destination: "/dashboard/calls/history", permanent: false },
      { source: "/console/review", destination: "/dashboard/calls/review", permanent: false },
      { source: "/console/overnight", destination: "/dashboard/suite/overnight", permanent: false },
      { source: "/console/rules", destination: "/dashboard/suite/rules", permanent: false },
      { source: "/stage", destination: "/dashboard/suite/live", permanent: false },
      { source: "/app", destination: "/dashboard", permanent: false },
      { source: "/app/:path*", destination: "/dashboard", permanent: false },
    ];
  },
  partialPrefetching: true,
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
