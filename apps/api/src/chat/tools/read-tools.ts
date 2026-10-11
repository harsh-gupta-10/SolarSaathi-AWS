import { z } from "zod";
import { identifier } from "../../data/schemas";
import { card, cleanLabel, resolveAnalysis, sqm, untrusted } from "./support";
import { defineTool } from "./types";

export const listMyProperties = defineTool({
  name: "list_my_properties",
  description: "List the signed-in user's saved properties (roofs) with ids and labels. Call this before asking for a property id.",
  schema: z.object({}).strict(),
  async run(_input, context) {
    const result = await context.services.core.listProperties(context.identity, { limit: 10 });
    const properties = result.properties.map(item => ({ propertyId: item.propertyId, label: cleanLabel(item.label, 120),
      address: cleanLabel(item.address, 300) }));
    const summary = properties.length ?
      `${properties.length} saved properties${result.nextCursor ? " (more exist)" : ""}: ${properties.map(item =>
        `id=${item.propertyId} ${untrusted("property_label", item.label)}`).join("; ")}` :
      "The user has no saved properties yet. Offer to start one from an address.";
    const data = properties.length ? { items: properties.map(item => ({ label: item.label, detail: item.address })),
      action: { label: "Open My roofs", href: "/app/properties" } } :
      { summary: "You have no saved roofs yet.", action: { label: "Add a roof", href: "/app/analyze" } };
    return { modelSummary: summary, cards: [card(context, "PROPERTY_LIST", "Your saved roofs", data,
      { provenance: { source: "STORED_PROPERTY_RECORDS", verificationStatus: "VERIFIED" } })] };
  },
});

export const getPropertySummary = defineTool({
  name: "get_property_summary",
  description: "Summarise one saved property: confirmed roof analyses (area, source, date) and number of application trackers.",
  schema: z.object({ propertyId: identifier }).strict(),
  async run(input, context) {
    const property = await context.services.core.getProperty(context.identity, input.propertyId);
    const [analyses, applications] = await Promise.all([
      context.services.core.listAnalyses(context.identity, input.propertyId, { limit: 5 }),
      context.services.applications.list(context.identity, input.propertyId, 5),
    ]);
    const latest = await resolveAnalysis(context, input.propertyId);
    const href = `/app/analyze?propertyId=${encodeURIComponent(property.propertyId)}`;
    const data = { summary: cleanLabel(property.address, 300),
      rows: [
        ...(latest ? [{ label: "Roof area", value: sqm(latest.roofAreaSquareMeters), note: latest.source === "MANUAL" ? "You measured this" : "Google Solar model, not a structural approval" },
          { label: "Measured on", value: latest.measuredAt.slice(0, 10) }] : [{ label: "Roof", value: "Not confirmed yet" }]),
        { label: "Confirmed roof records", value: String(analyses.analyses.length) },
        { label: "Application trackers", value: String(applications.applications.length) }],
      action: { label: latest ? "Open this roof" : "Find and confirm the roof", href } };
    const roofLine = latest ?
      `Latest confirmed roof: analysisId=${latest.analysisId}, ${latest.roofAreaSquareMeters.toFixed(1)} m2, source ${latest.source}, measured ${latest.measuredAt.slice(0, 10)}.` :
      "No confirmed roof yet. A building and roof must be confirmed before sizing.";
    return { modelSummary: `Property ${property.propertyId} ${untrusted("property_label", property.label)}. ${roofLine} Application trackers: ${applications.applications.length}.`,
      cards: [card(context, "ROOF_SUMMARY", cleanLabel(property.label, 120) || "Your roof", data,
        { provenance: { source: "STORED_PROPERTY_RECORDS", verificationStatus: latest?.source === "MANUAL" ? "INDICATIVE" : "VERIFIED",
          ...(latest ? { lastCheckedAt: latest.measuredAt } : {}) } })] };
  },
});

export const listMyCustomers = defineTool({
  name: "list_my_customers",
  description: "Broker only: list the broker organisation's customers (ids and names).",
  brokerOnly: true,
  schema: z.object({}).strict(),
  async run(_input, context) {
    const result = await context.services.core.listCustomers(context.identity, { limit: 20 });
    const customers = result.customers.map(item => ({ customerId: item.customerId, name: cleanLabel(item.name, 120) }));
    return { modelSummary: customers.length ? `Customers: ${customers.map(item =>
      `id=${item.customerId} ${untrusted("customer_name", item.name)}`).join("; ")}` : "No customers yet.", cards: [] };
  },
});
