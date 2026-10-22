import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import { Backdrop } from "@/components/Backdrop";

export const metadata: Metadata = { title: { default: "Glimpse", template: "%s · Glimpse" }, description: "Share photos, shorts and stories with friends." };
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#eceef1" }, { media: "(prefers-color-scheme: dark)", color: "#0f1115" }],
  width: "device-width", initialScale: 1,
};

// Runs before first paint, so a pinned theme never flashes the other one. A per-device preference,
// kept in localStorage; "system" (no attribute) follows the OS.
const THEME = `try{var t=localStorage.getItem("glimpse:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined; // per request: every page gets its own CSP nonce
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME }} /></head>
      <body>
        <Backdrop />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
