import type { CurrentIdentityResponse } from "@solarsaathi/types";
import { z } from "zod";
import type { VerifiedCognitoUser } from "./cognito";
import { unauthorized } from "./errors";

function text(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength ||
    Array.from(normalized).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    return undefined;
  }
  return normalized;
}

export function currentIdentityResponse(user: VerifiedCognitoUser, requestId: string): CurrentIdentityResponse {
  if (!Array.isArray(user.attributes)) throw unauthorized();
  const attributes = new Map<string, string>();
  const relevant = new Set(["sub", "email", "email_verified", "name", "given_name", "family_name", "preferred_username", "custom:organizationId"]);
  for (const attribute of user.attributes) {
    if (!attribute || typeof attribute.Name !== "string" || !relevant.has(attribute.Name)) continue;
    if (attributes.has(attribute.Name) || typeof attribute.Value !== "string") throw unauthorized();
    attributes.set(attribute.Name, attribute.Value);
  }
  // GetUser checks Cognito's current session state, including revocation, after JWT verification.
  if (attributes.get("sub") !== user.sub) throw unauthorized();
  const email = text(attributes.get("email"), 254);
  if (!email || !z.email().safeParse(email).success) throw unauthorized();
  const emailVerified = attributes.get("email_verified");
  if (emailVerified !== undefined && emailVerified !== "true" && emailVerified !== "false") throw unauthorized();
  const parts = [text(attributes.get("given_name"), 128), text(attributes.get("family_name"), 128)].filter(Boolean).join(" ");
  const name = text(attributes.get("name"), 256) ?? text(parts, 256) ??
    text(attributes.get("preferred_username"), 256) ?? email.split("@")[0];
  const rawOrganizationId = attributes.get("custom:organizationId");
  const organizationId = text(rawOrganizationId, 128);
  if (rawOrganizationId?.trim() && (!organizationId || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(organizationId))) {
    throw unauthorized();
  }
  return {
    profile: {
      userId: user.sub,
      cognitoSub: user.sub,
      email,
      name,
      role: user.groups.includes("BROKER") ? "BROKER" : "HOMEOWNER",
      ...(organizationId ? { organizationId } : {}),
    },
    emailVerified: emailVerified === "true",
    source: "COGNITO",
    requestId,
  };
}
