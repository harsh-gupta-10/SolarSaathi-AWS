"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { useAuth } from "../auth/auth-provider";
import { rememberPendingQuestion } from "../lib/pending-question";
import { signInHref } from "../lib/return-to";

const SUGGESTIONS = [
  "What would a 3 kW system cost for my home?",
  "Am I eligible for PM Surya Ghar?",
  "Help me get ready to apply",
  "How much could I save on my electricity bill?",
];

export function HeroAsk() {
  const id = useId();
  const router = useRouter();
  const { status } = useAuth();
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string>();

  function go(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3) { setError("Type a question of at least 3 characters."); return; }
    rememberPendingQuestion(trimmed);
    router.push(status === "signedIn" || status === "loading" ? "/app" : signInHref("/app"));
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); go(question); }

  return (
    <div className="w-full max-w-2xl">
      <form onSubmit={submit} noValidate className="rounded-[32px] bg-white p-3 focus-within:outline-2 focus-within:outline-black">
        <label htmlFor={id} className="sr-only">Ask SolarSaathi about your roof, costs or subsidies</label>
        <div className="flex items-end gap-2">
          <textarea
            id={id} rows={2} maxLength={2000} value={question}
            onChange={event => { setQuestion(event.target.value); setError(undefined); }}
            onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); go(question); } }}
            placeholder="Ask about solar for your home: cost, savings, subsidy, how to apply…"
            aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
            className="min-h-14 flex-1 resize-none rounded-xl bg-transparent px-3 py-2 text-base font-medium text-black outline-none placeholder:text-[#979797]"
          />
          <button type="submit" aria-label="Ask SolarSaathi" className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg bg-black text-white transition hover:bg-[#2f2f2f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
            <ArrowUp aria-hidden="true" className="size-5" />
          </button>
        </div>
      </form>
      {error && <p id={`${id}-error`} role="alert" className="mt-2 text-sm font-medium text-[#b42318]">{error}</p>}
      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Suggested questions">
        {SUGGESTIONS.map(text => (
          <li key={text}>
            <button type="button" onClick={() => go(text)} className="min-h-11 rounded-full bg-[#f3f3f3] px-4 text-sm font-medium text-black transition hover:bg-[#d1ffca] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
              {text}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-[#444]">Sign in is needed to analyze your roof or save anything. Estimates are never guarantees.</p>
    </div>
  );
}
