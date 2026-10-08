import type { AuthSession, AuthUser } from "aws-amplify/auth";

export interface AuthProfile {
  userId: string;
  cognitoSub: string;
  email: string;
  name: string;
  role: "HOMEOWNER" | "BROKER";
  organizationId?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getAuthProfile(
  user: AuthUser,
  session: AuthSession,
  attributes: Record<string, string | undefined>,
): AuthProfile {
  const identity = session.tokens?.idToken?.payload;
  const access = session.tokens?.accessToken.payload;
  const sub = text(identity?.sub);
  if (!identity || !access || !sub || user.userId !== sub || text(access.sub) !== sub ||
    identity.token_use !== "id" || access.token_use !== "access" ||
    (attributes.sub !== undefined && attributes.sub !== sub)) {
    throw new Error("Invalid identity session");
  }
  const groups = access["cognito:groups"];
  const organizationId = text(attributes["custom:organizationId"] ?? identity["custom:organizationId"]);
  return {
    userId: user.userId,
    cognitoSub: sub,
    email: text(attributes.email ?? identity.email),
    name: text(attributes.name ?? identity.name),
    role: Array.isArray(groups) && groups.includes("BROKER") ? "BROKER" : "HOMEOWNER",
    ...(organizationId ? { organizationId } : {}),
  };
}
