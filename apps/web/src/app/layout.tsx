import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = { title: { default: "Glimpse", template: "%s · Glimpse" }, description: "Share photos and videos with friends." };
export const viewport: Viewport = { themeColor: "#eceef1", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers(); // render per request, so every page gets its own CSP nonce
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
