"use client";

import { useState } from "react";
import type { ChatProposal } from "@solarsaathi/types";
import { Button, Callout, Card, CardContent, CardFooter, CardHeader, CardTitle } from "@solarsaathi/ui";
import { chatApi } from "../../lib/chat-api";

type Outcome = "idle" | "working" | "executed" | "expired" | "dismissed" | "failed";

/** A change the assistant wants to make. Nothing happens until the user clicks Confirm. */
export function ChatProposalView({ proposal }: { proposal: ChatProposal }) {
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [error, setError] = useState<string>();
  async function confirm() {
    setOutcome("working"); setError(undefined);
    try {
      const result = await chatApi.confirm(proposal.proposalId);
      setOutcome(result.status === "EXPIRED" ? "expired" : "executed");
    } catch (failure) {
      setOutcome("failed");
      setError(failure instanceof Error ? failure.message : "That could not be completed. Try again.");
    }
  }
  const done = outcome === "executed" || outcome === "expired" || outcome === "dismissed";
  return (
    <Card className="w-full border-primary/30" data-proposal-id={proposal.proposalId}>
      <CardHeader><CardTitle>Please confirm</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm">{proposal.summary}</p>
        {outcome === "executed" ? <Callout tone="success">Done.</Callout> : null}
        {outcome === "expired" ? <Callout tone="warning">This request expired. Ask again and I will prepare a new one.</Callout> : null}
        {outcome === "dismissed" ? <Callout>No changes were made.</Callout> : null}
        {error ? <Callout tone="danger">{error}</Callout> : null}
      </CardContent>
      {!done ? (
        <CardFooter>
          <Button type="button" disabled={outcome === "working"} onClick={() => void confirm()}>{outcome === "working" ? "Working…" : "Confirm"}</Button>
          <Button type="button" variant="ghost" disabled={outcome === "working"} onClick={() => setOutcome("dismissed")}>Not now</Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
