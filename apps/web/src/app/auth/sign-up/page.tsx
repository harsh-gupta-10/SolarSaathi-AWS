import type { Metadata } from "next";
import { SignInPanel } from "../../../auth/sign-in-panel";

export const metadata: Metadata = { title: "Create account — SolarSaathi" };

export default function SignUpPage() {
  return <SignInPanel createAccount />;
}
