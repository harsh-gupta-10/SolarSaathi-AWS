import { CookieStorage } from "aws-amplify/utils";

export function createAuthCookieStorage(protocol: string) {
  return new CookieStorage({
    path: "/", secure: protocol === "https:", sameSite: "lax", expires: 1,
  });
}
