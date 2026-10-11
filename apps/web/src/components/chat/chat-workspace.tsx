"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Loader2, MessageSquarePlus, PanelRight, Square, Trash2 } from "lucide-react";
import type { ChatCard, ChatSummary } from "@solarsaathi/types";
import { Badge, Button, Callout, EmptyState } from "@solarsaathi/ui";
import { useAuth } from "../../auth/auth-provider";
import { chatApi } from "../../lib/chat-api";
import { consumePendingQuestion } from "../../lib/pending-question";
import { signInHref } from "../../lib/return-to";
import { ChatCardView } from "./chat-card-view";
import { ChatProposalView } from "./chat-proposal-view";
import { pinnedCards, type UiMessage } from "./chat-state";
import { useChat } from "./use-chat";

const STARTERS = [
  "What would a 3 kW system cost for my home?",
  "Am I eligible for PM Surya Ghar?",
  "How much could I save on my electricity bill?",
  "Help me get ready to apply",
];

const TOOL_LABELS: Record<string, string> = {
  list_my_properties: "Looking at your properties", get_property_summary: "Reading your roof details",
  recommend_systems: "Comparing system sizes", estimate_savings: "Estimating savings", check_benefits: "Checking benefit rules",
  get_indicative_quote: "Preparing a cost range", research_prices: "Looking up recent prices", explain_policy: "Reading the policy record",
  prepare_application: "Preparing your checklist", start_property: "Preparing your property", confirm_roof: "Preparing roof confirmation",
  update_application_step: "Preparing the update",
};
const toolLabel = (name: string) => TOOL_LABELS[name] ?? "Working on it";

const ERROR_HELP: Record<string, string> = {
  RATE_LIMITED: "You have reached the chat limit for now. Please try again later.",
  BUDGET_EXCEEDED: "You have reached today's chat limit. It resets tomorrow.",
  GUARDRAIL_BLOCKED: "I can only help with rooftop solar, your electricity use, subsidies and applications. Please ask about one of those.",
  MODEL_ACCESS_DENIED: "The AI assistant has not been switched on for this deployment yet. You can still analyze your roof, compare systems and check benefits from My roofs.",
  MODEL_TIMEOUT: "The assistant took too long to answer. Please try again, or ask a shorter question.",
  MODEL_BUSY: "The assistant is busy right now. Please try again in a minute.",
  MODEL_UNAVAILABLE: "The assistant is unavailable right now. Please try again shortly.",
};

function MessageView({ message, onReply, onQuick }: { message: UiMessage; onReply: (card: ChatCard, value: string, label: string) => void;
  onQuick: (text: string) => void }) {
  if (message.role === "user") {
    return <div className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground">{message.text}</p></div>;
  }
  const activeTools = message.tools.filter(tool => tool.state === "started");
  return (
    <div className="grid max-w-3xl gap-3" aria-busy={message.streaming}>
      {message.text ? <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p> : null}
      {message.streaming && !message.text && activeTools.length === 0 ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />Thinking…</p> : null}
      {activeTools.map(tool => <p key={tool.name} className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />{toolLabel(tool.name)}…</p>)}
      {message.cards.map(card => <ChatCardView key={card.cardId} card={card} onReply={message.streaming ? undefined : onReply} />)}
      {message.proposals.map(proposal => <ChatProposalView key={proposal.proposalId} proposal={proposal} />)}
      {message.groundingReplaced ? <p className="text-xs text-muted-foreground">Some figures in my text were left out because they were not in the checked results. See the cards for the exact numbers.</p> : null}
      {!message.streaming && message.quickReplies.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Suggested replies">
          {message.quickReplies.map(item => <li key={item.value}><Button type="button" variant="outline" onClick={() => onQuick(item.value)}>{item.label}</Button></li>)}
        </ul>
      ) : null}
      {message.error ? <Callout tone="danger">
        {ERROR_HELP[message.error.code] ?? message.error.message}
        {message.error.requestId ? <span className="mt-1 block font-mono text-xs opacity-80">Reference for support: {message.error.requestId}</span> : null}
      </Callout> : null}
    </div>
  );
}

function linkedPropertyId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("propertyId");
  return value && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : undefined;
}

export function ChatWorkspace({ propertyId: explicitPropertyId }: { propertyId?: string }) {
  const { status } = useAuth();
  const [propertyId] = useState(() => explicitPropertyId ?? linkedPropertyId());
  const chat = useChat(propertyId);
  const [draft, setDraft] = useState("");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatsError, setChatsError] = useState<string>();
  const [panelOpen, setPanelOpen] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const pendingHandled = useRef(false);

  const refreshChats = useCallback(async () => {
    try { setChats((await chatApi.list()).chats); setChatsError(undefined); }
    catch { setChatsError("Your earlier chats could not be loaded."); }
  }, []);
  useEffect(() => { chat.setOnChatCreated(() => void refreshChats()); });
  useEffect(() => { if (status === "signedIn") void refreshChats(); }, [status, refreshChats]);

  // A question typed on the marketing page becomes the first turn.
  useEffect(() => {
    if (status !== "signedIn" || pendingHandled.current) return;
    pendingHandled.current = true;
    const pending = consumePendingQuestion();
    if (pending) void chat.send(pending);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" }); }, [chat.state.messages]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void chat.send(text);
  }
  function reply(card: ChatCard, value: string, label: string) { void chat.send(label, { card, value }); }
  async function remove(chatId: string) {
    if (!window.confirm("Delete this chat? This cannot be undone.")) return;
    try { await chatApi.remove(chatId); if (chat.state.chatId === chatId) chat.reset(); await refreshChats(); }
    catch { setChatsError("That chat could not be deleted. Try again."); }
  }

  if (status === "loading") return <p role="status" aria-live="polite">Checking your session…</p>;
  if (status !== "signedIn") {
    return <EmptyState title="Sign in to chat with SolarSaathi" description="Sign in to analyze your roof, get cost ranges and check subsidies. Your chats are saved to your account."
      action={<Button asChild><Link href={signInHref("/app")}>Sign in</Link></Button>} />;
  }

  const pinned = pinnedCards(chat.state.messages);
  const empty = chat.state.messages.length === 0;

  return (
    <div className="grid h-[calc(100dvh-11rem)] min-h-[30rem] gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_20rem]">
      <aside aria-label="Your chats" className="hidden min-h-0 flex-col gap-2 overflow-y-auto lg:flex">
        <Button type="button" variant="outline" onClick={() => chat.reset()}><MessageSquarePlus aria-hidden="true" />New chat</Button>
        {chatsError ? <p role="status" className="text-xs text-muted-foreground">{chatsError}</p> : null}
        <ul className="grid gap-1">
          {chats.map(item => (
            <li key={item.chatId} className="group flex items-center">
              <button type="button" onClick={() => void chat.open(item.chatId)} aria-current={chat.state.chatId === item.chatId ? "true" : undefined}
                className="min-h-11 flex-1 truncate rounded-md px-2 text-left text-sm hover:bg-accent aria-[current=true]:bg-accent aria-[current=true]:font-semibold">{item.title}</button>
              <button type="button" aria-label={`Delete chat ${item.title}`} onClick={() => void remove(item.chatId)}
                className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 aria-hidden="true" className="size-4" /></button>
            </li>
          ))}
        </ul>
      </aside>

      <section aria-label="Conversation" className="flex min-h-0 flex-col rounded-2xl border bg-background">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2 lg:hidden">
          <Button type="button" variant="ghost" size="sm" onClick={() => chat.reset()}><MessageSquarePlus aria-hidden="true" />New chat</Button>
          {pinned.length ? <Button type="button" variant="ghost" size="sm" onClick={() => setPanelOpen(open => !open)} aria-expanded={panelOpen}><PanelRight aria-hidden="true" />Summary</Button> : null}
        </div>
        <div ref={log} role="log" aria-live="polite" aria-label="Conversation" className="flex-1 overflow-y-auto px-4 py-5">
          {empty ? (
            <div className="mx-auto grid max-w-2xl gap-5 py-8">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">What would you like to know about solar?</h1>
                <p className="mt-2 text-muted-foreground">I can size a system for your roof, show a cost range with its sources, check which subsidies you may qualify for and prepare your application checklist. I never invent numbers: figures come from checked calculations and rules.</p>
              </div>
              <ul className="flex flex-wrap gap-2" aria-label="Suggested questions">
                {STARTERS.map(text => <li key={text}><button type="button" onClick={() => void chat.send(text)} className="min-h-11 rounded-full border px-4 text-sm font-medium hover:bg-accent">{text}</button></li>)}
              </ul>
              <p className="text-sm text-muted-foreground">To analyze a specific roof, <Link className="font-medium text-primary underline underline-offset-2" href="/app/analyze">find your roof on the map</Link> first, then come back and ask.</p>
            </div>
          ) : (
            <div className="mx-auto grid max-w-3xl gap-6">
              {chat.state.messages.map(message => <MessageView key={message.id} message={message} onReply={reply} onQuick={text => void chat.send(text)} />)}
            </div>
          )}
        </div>
        {panelOpen && pinned.length ? <div className="grid max-h-64 gap-3 overflow-y-auto border-t p-3 xl:hidden">{pinned.map(card => <ChatCardView key={card.cardId} card={card} compact />)}</div> : null}
        <form onSubmit={submit} className="border-t p-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-background p-2 focus-within:ring-[3px] focus-within:ring-ring/30">
            <label htmlFor="chat-composer" className="sr-only">Message SolarSaathi</label>
            <textarea id="chat-composer" ref={composer} rows={1} maxLength={2000} value={draft} onChange={event => setDraft(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
              placeholder="Ask about your roof, costs, subsidies or your application…"
              className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base outline-none placeholder:text-muted-foreground" />
            {chat.busy
              ? <Button type="button" size="icon" variant="outline" aria-label="Stop" onClick={chat.stop}><Square aria-hidden="true" /></Button>
              : <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim()}><ArrowUp aria-hidden="true" /></Button>}
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">SolarSaathi can make mistakes. Estimates are not offers or approvals. Do not share Aadhaar, bank details, passwords or OTPs.</p>
        </form>
      </section>

      <aside aria-label="Your solar summary" className="hidden min-h-0 gap-3 overflow-y-auto xl:grid xl:content-start">
        <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Your solar summary</h2><Badge>Live</Badge></div>
        {pinned.length ? pinned.map(card => <ChatCardView key={card.cardId} card={card} compact />)
          : <p className="text-sm text-muted-foreground">Your roof, system, quote and benefit results appear here as we go.</p>}
      </aside>
    </div>
  );
}
