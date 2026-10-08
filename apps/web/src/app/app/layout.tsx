import type { ReactNode } from "react";
import type { Metadata } from "next";
import { AppShell } from "../../components/app-shell";

export const metadata: Metadata = { title: "Workspace | SolarSaathi", robots: { index: false, follow: false } };
export default function WorkspaceLayout({ children }: { children: ReactNode }) { return <AppShell>{children}</AppShell>; }
