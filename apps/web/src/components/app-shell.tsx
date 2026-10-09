"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Building2, ClipboardList, FileCheck2, FileText, HelpCircle, Home, Layers, Leaf, Menu, MessageCircle, Search, Settings, ShieldCheck, Sun, Users, Wallet, Wrench } from "lucide-react";
import { Button, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@solarsaathi/ui";
import type { UserRole } from "@solarsaathi/types";
import { isSectionActive, navigationForRole, sectionPath } from "../lib/navigation";
import { WorkspaceRoleProvider, useWorkspaceRole } from "./workspace-role";
import { useAuth } from "../auth/auth-provider";

const icons = { overview: Home, analyze: Search, properties: Building2, savings: Wallet, benefits: FileCheck2, applications: ClipboardList, advisor: MessageCircle, designs: Leaf, accessories: Wrench, help: HelpCircle, settings: Settings, customers: Users, analyses: Layers, leads: Users, proposals: FileText };
function WorkspaceNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useWorkspaceRole();
  const { status, profile } = useAuth();
  const pathname = usePathname();
  return <nav aria-label="Workspace navigation"><ul className="workspace-links">{navigationForRole(role).map(item => {
    const Icon = icons[item.key as keyof typeof icons];
    const href = sectionPath(item.key);
    return <li key={item.key}><Link href={href} onClick={onNavigate} aria-current={isSectionActive(pathname, item.key) ? "page" : undefined}><Icon size={19} aria-hidden="true" />{item.label}</Link></li>;
  })}{status === "signedIn" && profile?.policyAdmin ? <li><Link href="/app/policy-admin" onClick={onNavigate} aria-current={pathname === "/app/policy-admin" ? "page" : undefined}><ShieldCheck size={19} aria-hidden="true" />Policy review</Link></li> : null}</ul></nav>;
}
function Shell({ children }: { children: ReactNode }) {
  const { role, setRole, previewAllowed } = useWorkspaceRole();
  const { status, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const statusText = status === "signedIn" ? "Account connected. Open Analyze Roof to check assessment availability."
    : status === "loading" ? "Checking your account session…"
    : status === "signedOut" ? "Sign in to connect your account. The planning preview remains available."
    : status === "error" ? "The account session could not be restored. Open sign-in to retry."
    : "Development preview. Navigation roles do not grant account permissions.";
  return <div className="app-layout">
    <aside className="desktop-sidebar">
      <Link className="brand" href="/"><Sun aria-hidden="true" /><span>SolarSaathi</span></Link>
      <p className="workspace-caption">Your solar workspace</p><WorkspaceNavigation />
      <p className="sidebar-note">{status === "signedIn" ? "Property and customer records are accessed only through authenticated backend requests." : "Preview only. No account, organization or customer data is loaded."}</p>
    </aside>
    <div className="workspace-body">
      <header className="workspace-header">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild><Button variant="ghost" size="icon" className="mobile-menu" aria-label="Open navigation"><Menu aria-hidden="true" /></Button></SheetTrigger>
          <SheetContent side="left" className="mobile-sheet"><SheetHeader><SheetTitle>SolarSaathi</SheetTitle><SheetDescription>Your workspace navigation</SheetDescription></SheetHeader><WorkspaceNavigation onNavigate={() => setOpen(false)} /></SheetContent>
        </Sheet>
        {previewAllowed ? <div className="role-picker"><label htmlFor="navigation-role">Navigation preview</label><select id="navigation-role" value={role} onChange={event => setRole(event.target.value as UserRole)}><option value="HOMEOWNER">Homeowner</option><option value="BROKER">Broker / consultant</option></select></div> : <p className="account-identity">{profile?.name || "Solar workspace"}</p>}
        <div className="header-actions"><Button asChild variant="ghost"><Link href={status === "signedIn" ? "/app/settings" : "/auth/sign-in"}>{status === "signedIn" ? "Account" : "Sign in"}</Link></Button><Link href="/" className="back-to-site">Back to site<ArrowUpRight size={16} aria-hidden="true" /></Link></div>
      </header>
      <div className="workspace-status" role="status">{statusText}</div>
      <main id="main-content" className="workspace-content">{children}</main>
    </div>
  </div>;
}
export function AppShell({ children }: { children: ReactNode }) { return <WorkspaceRoleProvider><Shell>{children}</Shell></WorkspaceRoleProvider>; }
