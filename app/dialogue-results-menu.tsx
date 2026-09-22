"use client";

import { useEffect, useRef, useState } from "react";
import type { DialogueCard, DialogueThread } from "./dialogue-model";

export function DialogueResultsMenu({ threadId, ready, visible, revision, onOpen }: {
  threadId: string | null;
  ready: boolean;
  visible: boolean;
  revision: number;
  onOpen: (card: DialogueCard) => void;
}) {
  const [cards, setCards] = useState<DialogueCard[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!ready || !visible || !threadId) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setFailed(false);
      try {
        const response = await fetch(`/api/dialogue?id=${encodeURIComponent(threadId!)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!response.ok) throw new Error("Results unavailable");
        const payload = await response.json() as { thread?: DialogueThread };
        if (!Array.isArray(payload.thread?.data.cards)) throw new Error("Invalid results");
        if (!controller.signal.aborted) setCards(payload.thread.data.cards);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [threadId, ready, visible, revision, retry]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!threadId) return null;
  return <div ref={container} className="klio-chatkit-results">
    <button ref={trigger} type="button" className="klio-chatkit-results-trigger" disabled={!ready} aria-expanded={open} aria-controls={open ? "chatkit-results-list" : undefined} onClick={() => setOpen((value) => !value)}>
      Результаты{cards.length > 0 && <span>{cards.length}</span>}<span aria-hidden="true">⌄</span>
    </button>
    {open && <div id="chatkit-results-list" className="klio-chatkit-results-list" role="group" aria-label="Результаты этого диалога">
      {cards.map((card) => <button key={card.id} type="button" onClick={() => { setOpen(false); onOpen(card); }}>
        <small>{card.imageUrl && !card.body.trim() ? "Изображение" : card.kind === "topic" ? "Тема" : card.kind === "note" ? "Заметка" : "Текст"}</small>
        <span>{card.title}</span>
      </button>)}
      {!cards.length && !failed && <p>{loading ? "Загружаем результаты…" : "Здесь появятся темы, тексты и изображения этого диалога"}</p>}
      {failed && <div role="status"><p>Не удалось обновить результаты</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Повторить</button></div>}
    </div>}
  </div>;
}
