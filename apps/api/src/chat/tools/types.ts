import type { ChatCard, ChatProposal, ChatQuickReply, CurrentIdentityResponse } from "@solarsaathi/types";
import type { z } from "zod";
import type { GroundingContext } from "../grounding";
import type { ChatServices } from "../services";

export interface ToolContext {
  identity: CurrentIdentityResponse;
  requestId: string;
  chatId: string;
  /** Optional property the user is working on (already ownership-checked by the caller). */
  propertyId?: string;
  services: ChatServices;
  /** Numbers the user typed in this conversation window; tool arguments claiming user figures must appear here. */
  userFigures: ReadonlySet<number>;
  grounding: GroundingContext;
  now: () => Date;
  createId: () => string;
}

export interface ToolOutput {
  /** Small, trusted text for the model. Numbers here may be restated by the model; untrusted text is delimited. */
  modelSummary: string;
  cards: ChatCard[];
  quickReplies?: ChatQuickReply[];
  proposal?: ChatProposal;
}

export interface ChatTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  brokerOnly?: boolean;
  /** True when the tool can only create a proposal; it never mutates data itself. */
  proposalOnly?: boolean;
  run(input: z.infer<S>, context: ToolContext): Promise<ToolOutput>;
}

export function defineTool<S extends z.ZodType>(tool: ChatTool<S>): ChatTool<S> { return tool; }
