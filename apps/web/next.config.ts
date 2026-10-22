import type { NextConfig } from "next";

// In Docker, Caddy sends /api, /media and /socket.io straight to the API.
// In local development (no Caddy), Next forwards them instead.
const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Socket.IO lives at "/socket.io/" (with the slash); don't let Next redirect it away.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/media/:path*", destination: `${api}/media/:path*` },
      { source: "/socket.io/", destination: `${api}/socket.io/` },
      { source: "/socket.io/:path*", destination: `${api}/socket.io/:path*` },
    ];
  },
};
export default config;
