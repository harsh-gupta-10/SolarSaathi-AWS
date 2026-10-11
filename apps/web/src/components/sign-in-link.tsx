"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@solarsaathi/ui";
import { signInHref } from "../lib/return-to";

/** Sign-in button that returns the user to the page they were on (validated same-origin path). */
export function SignInLink({ children = "Sign in", variant, size }: { children?: ReactNode; variant?: "default" | "outline" | "ghost"; size?: "default" | "sm" }) {
  const [href, setHref] = useState("/auth/sign-in");
  useEffect(() => { setHref(signInHref(window.location.pathname + window.location.search)); }, []);
  return <Button asChild variant={variant} size={size}><Link href={href}>{children}</Link></Button>;
}
