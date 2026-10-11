import { z } from "zod";
import type { Tool } from "@aws-sdk/client-bedrock-runtime";
import { recommendAccessories, estimateSavings, recommendSystems } from "./design-tools";
import { checkBenefits, explainPolicy } from "./policy-tools";
import { getIndicativeQuote, researchPrices } from "./price-tools";
import { confirmRoof, prepareApplication, startProperty, updateApplicationStep } from "./proposal-tools";
import { getPropertySummary, listMyCustomers, listMyProperties } from "./read-tools";
import type { ChatTool } from "./types";

const ALL_TOOLS: ReadonlyArray<ChatTool> = [
  checkBenefits, confirmRoof, estimateSavings, explainPolicy, getIndicativeQuote, getPropertySummary, listMyCustomers,
  listMyProperties, prepareApplication, recommendAccessories, recommendSystems, researchPrices, startProperty, updateApplicationStep,
] as ReadonlyArray<ChatTool>;

/** Fixed, name-sorted list. Broker-only tools are present only for the BROKER role. Order must stay stable for prompt caching. */
export function toolsForRole(role: "HOMEOWNER" | "BROKER"): ChatTool[] {
  return ALL_TOOLS.filter(tool => !tool.brokerOnly || role === "BROKER").sort((a, b) => a.name < b.name ? -1 : 1);
}

export function toolSpecs(tools: readonly ChatTool[]): Tool[] {
  return tools.map(tool => {
    const schema = { ...(z.toJSONSchema(tool.schema, { target: "draft-7", io: "input" }) as Record<string, unknown>) };
    delete schema.$schema;
    return { toolSpec: { name: tool.name, description: tool.description, inputSchema: { json: schema as never }, strict: true } } as Tool;
  });
}
export { ALL_TOOLS };
