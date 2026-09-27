import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "API Shield - Zero-Trust LLM Guardrail Proxy",
  description: "Enterprise-grade guardrails, security proxy, and real-time telemetry engine.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark scroll-smooth">
      <body className={`${inter.className} bg-zinc-950 text-zinc-100 flex min-h-screen overflow-hidden`}>
        <Sidebar />
        <main className="flex-1 overflow-y-auto relative h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
