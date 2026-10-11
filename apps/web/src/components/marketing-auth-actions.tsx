"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import { useAuth } from "../auth/auth-provider";
import { signInHref } from "../lib/return-to";

// While the session is still loading, send people to the workspace instead of the sign-in page: a signed-in
// user must not be bounced to sign-in, and the workspace shows its own signed-out prompt.
function useWorkspaceHref(): string {
  const { status } = useAuth();
  return status === "signedOut" || status === "unconfigured" || status === "error" ? signInHref("/app") : "/app";
}

export function MarketingHeaderActions() {
  const { status } = useAuth();
  const href = useWorkspaceHref();
  return (
    <div className="flex items-center gap-2">
      {status === "signedOut" && (
        <Button asChild variant="ghost" size="sm" className="samara-pill-ghost">
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
      )}
      <Button asChild size="sm" className="samara-btn-primary">
        <Link href={href}>
          <span>Dashboard</span>
          <ArrowUpRight aria-hidden="true" className="ml-1 size-3.5" />
        </Link>
      </Button>
    </div>
  );
}

export function MarketingConsultantAction() {
  const href = useWorkspaceHref();
  return (
    <Button asChild variant="outline" className="samara-btn-secondary">
      <Link href={href}>
        <span>Explore the workspace</span>
        <ArrowUpRight aria-hidden="true" className="ml-1 size-4" />
      </Link>
    </Button>
  );
}

export function MarketingFooterDashboardLink() {
  const href = useWorkspaceHref();
  return <Link href={href} className="text-inherit hover:underline">Dashboard</Link>;
}
