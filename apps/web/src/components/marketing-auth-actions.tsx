"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@solarsaathi/ui";
import { useAuth } from "../auth/auth-provider";

export function MarketingHeaderActions() {
  const { status } = useAuth();
  const router = useRouter();

  function onDashboardClick(event: React.MouseEvent) {
    event.preventDefault();
    if (status === "signedIn") {
      router.push("/app");
    } else {
      router.push("/auth/sign-in");
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status === "signedIn" ? (
        <Button asChild size="sm" className="samara-btn-primary">
          <Link href="/app">
            <span>Dashboard</span>
            <ArrowUpRight aria-hidden="true" className="ml-1 size-3.5" />
          </Link>
        </Button>
      ) : (
        <>
          <Button asChild variant="ghost" size="sm" className="samara-pill-ghost">
            <Link href="/auth/sign-in">Sign in</Link>
          </Button>
          <Button size="sm" className="samara-btn-primary" onClick={onDashboardClick}>
            <span>Dashboard</span>
            <ArrowUpRight aria-hidden="true" className="ml-1 size-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

export function MarketingConsultantAction() {
  const { status } = useAuth();
  const router = useRouter();

  function onClick(event: React.MouseEvent) {
    event.preventDefault();
    if (status === "signedIn") {
      router.push("/app");
    } else {
      router.push("/auth/sign-in");
    }
  }

  return (
    <Button variant="outline" className="samara-btn-secondary" onClick={onClick}>
      <span>Explore the workspace</span>
      <ArrowUpRight aria-hidden="true" className="ml-1 size-4" />
    </Button>
  );
}

export function MarketingFooterDashboardLink() {
  const { status } = useAuth();
  const router = useRouter();

  function onClick(event: React.MouseEvent) {
    event.preventDefault();
    if (status === "signedIn") {
      router.push("/app");
    } else {
      router.push("/auth/sign-in");
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-inherit hover:underline cursor-pointer bg-transparent border-none p-0 inline font-inherit text-left"
    >
      Dashboard
    </button>
  );
}
