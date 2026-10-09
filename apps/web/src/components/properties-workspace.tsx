"use client";

import { useWorkspaceRole } from "./workspace-role";
import { useAuth } from "../auth/auth-provider";
import { BrokerWorkspace } from "./broker-workspace";
import { MyPropertiesWorkspace } from "./my-properties-workspace";

export function PropertiesWorkspace() {
  const { role } = useWorkspaceRole();
  const { status, profile } = useAuth();

  if (status === "signedIn" && profile?.role === "BROKER" && role === "BROKER") {
    return <BrokerWorkspace section="properties" />;
  }

  return <MyPropertiesWorkspace />;
}
