"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useAuth } from "../auth/auth-provider";
import { signInHref } from "../lib/return-to";

// While the session is still loading, send people to the workspace instead of the sign-in page: a signed-in
// user must not be bounced to sign-in, and the workspace shows its own signed-out prompt.
function useWorkspaceHref(): string {
  const { status } = useAuth();
  return status === "signedOut" || status === "unconfigured" || status === "error" ? signInHref("/app") : "/app";
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

export function MarketingHeaderActions() {
  const { status } = useAuth();
  const href = useWorkspaceHref();
  return (
    <div className="flex items-center gap-2">
      {status === "signedOut" && (
        <Link href="/auth/sign-in" className={`inline-flex min-h-11 items-center rounded-lg px-4 text-base font-medium text-[#444] hover:text-black ${FOCUS}`}>
          Sign in
        </Link>
      )}
      <Link href={href} className={`inline-flex min-h-11 items-center gap-1 rounded-lg bg-black px-5 text-base font-medium text-white transition hover:bg-[#2f2f2f] ${FOCUS}`}>
        Dashboard
        <ArrowUpRight aria-hidden="true" className="size-4" />
      </Link>
    </div>
  );
}

export function MarketingConsultantAction() {
  const href = useWorkspaceHref();
  return (
    <Link href={href} className={`inline-flex min-h-12 items-center gap-1 rounded-lg bg-black px-6 text-base font-medium text-white transition hover:bg-[#2f2f2f] ${FOCUS}`}>
      Explore the workspace
      <ArrowUpRight aria-hidden="true" className="size-4" />
    </Link>
  );
}

export function MarketingFooterDashboardLink() {
  const href = useWorkspaceHref();
  return <Link href={href} className="text-inherit hover:underline">Dashboard</Link>;
}
