import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Anton, Inter, JetBrains_Mono } from "next/font/google";
import { getPublicEnvironment } from "../lib/env";
import { AppProviders } from "../components/app-providers";
import "./globals.css";

// Display/mono faces for the brutalist-editorial marketing page (flat canvas, oversized condensed uppercase type).
const display = Anton({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-display" });
const mono = JetBrains_Mono({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-mono" });
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: "SolarSaathi | Rooftop solar, with clarity",
  description: "An India-first rooftop-solar decision and assistance platform. Currently in development.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  getPublicEnvironment();

  return (
    <html lang="en-IN" className={`${inter.variable} ${display.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
