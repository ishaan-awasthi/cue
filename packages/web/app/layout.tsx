import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cue — Presentation Coach",
  description: "Real-time smart glasses presentation coaching",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-gray-950">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">{children}</body>
    </html>
  );
}
