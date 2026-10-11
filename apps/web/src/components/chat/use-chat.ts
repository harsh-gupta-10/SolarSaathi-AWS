"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatCard } from "@solarsaathi/types";
import { chatApi } from "../../lib/chat-api";
import { RoofRequestError } from "../../lib/roof-api";
import { applyStreamEvent, assistantPlaceholder, emptyChat, failLast, fromStored, userMessage, type ChatState } from "./chat-state";

export function useChat(propertyId?: string) {
  const [state, setState] = useState<ChatState>(emptyChat);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const chatIdRef = useRef<string | undefined>(undefined);
  chatIdRef.current = state.chatId;
  const onChatCreated = useRef<(() => void) | undefined>(undefined);

  useEffect(() => () => controller.current?.abort(), []);

  const send = useCallback(async (text: string, reply?: { card: ChatCard; value: string }) => {
    const message = text.trim();
    if (!message || busy) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const startedNewChat = !chatIdRef.current;
    setBusy(true);
    setState(previous => ({ ...previous, messages: [...previous.messages, userMessage(message), assistantPlaceholder()] }));
    try {
      await chatApi.stream({ ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}), message,
        ...(propertyId ? { propertyId } : {}), ...(reply ? { reply: { cardId: reply.card.cardId, value: reply.value } } : {}) },
      event => setState(previous => applyStreamEvent(previous, event)), abort.signal);
      setState(previous => failLast(previous, "The reply ended unexpectedly. Try again."));
    } catch (failure) {
      if (!abort.signal.aborted) {
        setState(previous => failLast(previous, failure instanceof RoofRequestError ? failure.message : "The assistant could not answer. Try again."));
      } else {
        setState(previous => failLast(previous, "Stopped."));
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      setBusy(false);
      if (startedNewChat) onChatCreated.current?.();
    }
  }, [busy, propertyId]);

  const stop = useCallback(() => controller.current?.abort(), []);
  const reset = useCallback(() => { controller.current?.abort(); setBusy(false); setState(emptyChat); }, []);
  const open = useCallback(async (chatId: string) => {
    controller.current?.abort(); setBusy(false);
    const detail = await chatApi.get(chatId);
    setState({ chatId: detail.chat.chatId, messages: fromStored(detail.messages) });
  }, []);

  return { state, busy, send, stop, reset, open, setOnChatCreated: (callback: () => void) => { onChatCreated.current = callback; } };
}
