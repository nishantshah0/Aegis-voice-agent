import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The console moved into the signed-in app (/app). Old links, DEMO.md and bookmarks
  // keep working. /stage stays the full-screen projector view; /phone stays the device.
  async redirects() {
    return [
      { source: "/console", destination: "/app/pharmacy/today", permanent: false },
      { source: "/console/today", destination: "/app/pharmacy/today", permanent: false },
      { source: "/console/upcoming", destination: "/app/pharmacy/upcoming", permanent: false },
      { source: "/console/calls", destination: "/app/pharmacy/calls", permanent: false },
      { source: "/console/review", destination: "/app/pharmacy/review", permanent: false },
      { source: "/console/rules", destination: "/app/safety/rules", permanent: false },
      { source: "/console/overnight", destination: "/app/safety/overnight", permanent: false },
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
