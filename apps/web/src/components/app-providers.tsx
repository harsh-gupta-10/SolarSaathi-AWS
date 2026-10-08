"use client";
import type { ReactNode } from "react";
import { AuthProvider } from "../auth/auth-provider";
export function AppProviders({ children }: { children: ReactNode }) { return <AuthProvider>{children}</AuthProvider>; }
