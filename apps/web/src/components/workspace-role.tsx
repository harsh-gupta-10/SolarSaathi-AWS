"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { UserRole } from "@solarsaathi/types";
import { useAuth } from "../auth/auth-provider";

const KEY = "solarsaathi.navigation-preview.v1";
const RoleContext = createContext<{ role: UserRole; setRole: (role: UserRole) => void; previewAllowed: boolean }>({ role: "HOMEOWNER", setRole: () => undefined, previewAllowed: false });
export function WorkspaceRoleProvider({ children }: { children: ReactNode }) {
  const { status, profile } = useAuth();
  const [previewRole, updateRole] = useState<UserRole>("HOMEOWNER");
  const previewAllowed = status === "unconfigured";
  const role = status === "signedIn" && profile ? profile.role : previewAllowed ? previewRole : "HOMEOWNER";
  useEffect(() => {
    try { if (sessionStorage.getItem(KEY) === "BROKER") updateRole("BROKER"); } catch { /* Navigation preview remains available without storage. */ }
  }, []);
  function setRole(next: UserRole) {
    if (!previewAllowed) return;
    updateRole(next);
    try { sessionStorage.setItem(KEY, next); } catch { /* The selection still applies for the current page. */ }
  }
  return <RoleContext.Provider value={{ role, setRole, previewAllowed }}>{children}</RoleContext.Provider>;
}
export function useWorkspaceRole() { return useContext(RoleContext); }
