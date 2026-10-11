import type { UserRole } from "@solarsaathi/types";

export interface NavigationItem { key: string; label: string; description: string; phase: number; }
const items: Record<string, NavigationItem> = {
  overview: { key: "overview", label: "Overview", description: "Your solar planning workspace.", phase: 1 },
  analyze: { key: "analyze", label: "Analyze Roof", description: "Locate your building, confirm the roof and review its solar potential.", phase: 4 },
  properties: { key: "properties", label: "My Properties", description: "Keep your properties and roof assessments together.", phase: 3 },
  savings: { key: "savings", label: "Savings", description: "Understand system cost, generation assumptions and year-by-year savings.", phase: 7 },
  benefits: { key: "benefits", label: "Government Benefits", description: "Review verified incentives and why each benefit can or cannot be combined.", phase: 10 },
  international: { key: "international", label: "Outside India", description: "Check selected official solar sources on demand with clear coverage limits.", phase: 17 },
  applications: { key: "applications", label: "Application Tracker", description: "Follow your policy-specific checklist and record application updates.", phase: 12 },
  advisor: { key: "advisor", label: "AI Advisor", description: "Get explanations grounded in your assessment and traceable policy sources.", phase: 13 },
  designs: { key: "designs", label: "Rooftop Ideas", description: "Explore concepts for modeled space left after solar, without implying structural approval.", phase: 15 },
  accessories: { key: "accessories", label: "Accessories", description: "Find compatible equipment based on your goals, not upselling.", phase: 14 },
  help: { key: "help", label: "Help", description: "Learn how the SolarSaathi planning process works.", phase: 1 },
  settings: { key: "settings", label: "Settings", description: "Manage your account and workspace preferences.", phase: 2 },
  customers: { key: "customers", label: "Customers", description: "Manage customers within your organization.", phase: 16 },
  analyses: { key: "analyses", label: "Analyses", description: "Review your customers’ confirmed roof assessments.", phase: 16 },
  leads: { key: "leads", label: "Leads", description: "Track opportunities and next steps for your organization.", phase: 16 },
  proposals: { key: "proposals", label: "Proposals", description: "Prepare policy-backed, customer-scoped planning snapshots.", phase: 16 },
};
// Savings, Government Benefits and Outside India are not in the sidebar. Their pages and routes remain, because chat cards
// and saved links point to them; they are simply not offered as navigation.
const homeowner = ["overview", "analyze", "properties", "applications", "advisor", "designs", "accessories", "help", "settings"];
const broker = ["overview", "customers", "properties", "analyses", "proposals", "applications", "leads", "advisor", "designs", "accessories", "settings"];

// Primary destinations stay short; step-level tools live under "More tools" and are also reachable from chat cards.
const homeownerPrimary = ["overview", "properties", "applications", "help", "settings"];
const brokerPrimary = ["overview", "customers", "properties", "analyses", "proposals", "applications", "leads", "settings"];

export function navigationGroupsForRole(role: UserRole): { primary: NavigationItem[]; more: NavigationItem[] } {
  const all = navigationForRole(role);
  const primaryKeys = role === "BROKER" ? brokerPrimary : homeownerPrimary;
  const primary = primaryKeys.flatMap(key => all.filter(item => item.key === key));
  return { primary, more: all.filter(item => !primaryKeys.includes(item.key)) };
}

export function navigationForRole(role: UserRole): NavigationItem[] {
  return (role === "BROKER" ? broker : homeowner).map(key => ({
    ...items[key],
    ...(role !== "BROKER" && key === "overview" ? { label: "Chat" } : {}),
    ...(role !== "BROKER" && key === "properties" ? { label: "My roofs" } : {}),
    ...(role === "BROKER" && key === "properties" ? { label: "Properties" } : {}),
    ...(role === "BROKER" && key === "applications" ? { label: "Applications" } : {}),
    ...(role === "BROKER" && key === "benefits" ? { label: "Benefits" } : {}),
    ...(role === "BROKER" && key === "designs" ? { label: "Designs" } : {}),
  }));
}
export function navigationItem(key: string): NavigationItem | undefined { return items[key]; }
export function sectionKeys(): string[] { return Object.keys(items).filter(key => key !== "overview"); }
export function sectionPath(key: string): string { return key === "overview" ? "/app" : `/app/${key}`; }
export function isSectionActive(pathname: string, key: string): boolean {
  const normalized = pathname.replace(/^\/app(?=\/|$)/, "") || "/";
  return normalized === (key === "overview" ? "/" : `/${key}`);
}
