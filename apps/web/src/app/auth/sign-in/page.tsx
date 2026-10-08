import type { Metadata } from "next";
import { SignInPanel } from "../../../auth/sign-in-panel";

export const metadata: Metadata = { title: "Sign in — SolarSaathi" };

export default function SignInPage() {
  return <SignInPanel />;
}
