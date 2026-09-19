import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "GridMind — Agent Coordination & Control Plane",
  description: "Developer control plane for autonomous coding agents on local Git worktrees.",
};

const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('gridmind-theme');
    var theme = stored;
    if (!theme || (theme !== 'light' && theme !== 'dark')) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.className} min-h-screen bg-bg text-fg selection:bg-selection`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}