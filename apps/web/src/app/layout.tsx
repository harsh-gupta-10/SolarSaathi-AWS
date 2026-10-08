import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getPublicEnvironment } from "../lib/env";
import { AppProviders } from "../components/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "SolarSaathi | Rooftop solar, with clarity",
  description: "An India-first rooftop-solar decision and assistance platform. Currently in development.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  getPublicEnvironment();

  return (
    <html lang="en-IN">
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
