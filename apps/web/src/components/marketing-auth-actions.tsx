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
    <Link
      href={href}
      className={`group inline-flex min-h-14 shrink-0 items-center gap-3 whitespace-nowrap rounded-full bg-black pl-7 pr-3 py-2.5 text-base font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1a1a1a] hover:shadow-[0_12px_28px_rgba(0,0,0,0.28)] ${FOCUS}`}
    >
      <span>Explore the workspace</span>
      <span
        aria-hidden="true"
        className="inline-flex size-9 items-center justify-center rounded-full bg-[#fff100] text-black transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
      >
        <ArrowUpRight className="size-4 stroke-[2.5]" />
      </span>
    </Link>
  );
}

export function MarketingFooterDashboardLink() {
  const href = useWorkspaceHref();
  return <Link href={href} className="text-inherit hover:underline">Dashboard</Link>;
}
