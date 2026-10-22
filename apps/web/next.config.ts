import type { NextConfig } from "next";

// In Docker, Caddy sends /api and /socket.io to the API, and /media and /uploads to object storage.
// In local development (no Caddy), Next forwards them instead.
const api = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const storage = process.env.STORAGE_INTERNAL_URL ?? "http://localhost:8333";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Socket.IO lives at "/socket.io/" (with the slash); don't let Next redirect it away.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/media/:path*", destination: `${storage}/media/:path*` },
      // Dev only. Storage that checks signatures needs the Host header kept, which Caddy does and this rewrite doesn't.
      { source: "/uploads/:path*", destination: `${storage}/uploads/:path*` },
      { source: "/socket.io/", destination: `${api}/socket.io/` },
      { source: "/socket.io/:path*", destination: `${api}/socket.io/:path*` },
    ];
  },
};
export default config;
