import type { Metadata } from "next";
import { GuidedDemo } from "../../components/guided-demo";
import { demoPolicyFinancialResponse } from "./policy-financial-fixture";

export const metadata: Metadata = {
  title: "Guided demo | SolarSaathi",
  description: "Explore a clearly fictional rooftop-solar decision journey, from building selection to source trail.",
  robots: { index: false, follow: false },
};

const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const formatPaise = (value: number) => money.format(value / 100);
const projection = demoPolicyFinancialResponse.projection;

export default function DemoPage() {
  return <GuidedDemo financial={projection ? {
    gross: formatPaise(projection.grossCostPaise),
    central: formatPaise(projection.selectedByScopePaise.CENTRAL),
    selectedTotal: formatPaise(projection.totalEligibleBenefitPaise),
    net: formatPaise(projection.netUpfrontCostPaise),
    coverageComplete: projection.coverageComplete,
  } : null} />;
}
