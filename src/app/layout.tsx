import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GridMind — Local AI coding-agent control plane",
  description: "Coordinate OpenCode and Codex agents on local Git projects.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}