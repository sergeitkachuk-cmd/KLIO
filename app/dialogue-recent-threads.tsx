"use client";

import { useEffect, useState } from "react";
import type { DialogueThread } from "./dialogue-model";

type RecentThread = Pick<DialogueThread, "id" | "title" | "status">;

export function DialogueRecentThreads({ brandId, activeThreadId, ready, visible, revision, onOpen, onHistory }: {
  brandId: string | null;
  activeThreadId: string | null;
  ready: boolean;
  visible: boolean;
  revision: number;
  onOpen: (id: string) => void;
  onHistory: () => void;
}) {
  const [threads, setThreads] = useState<RecentThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!ready || !visible) return;
    const controller = new AbortController();
    // The parent is keyed by user and brand, so a switch starts with an empty
    // list. Ignore late responses when switching brands or refreshing again.
    async function load() {
      setLoading(true);
      setFailed(false);
      try {
        const query = new URLSearchParams();
        if (brandId) query.set("brandId", brandId);
        const response = await fetch(`/api/dialogue?${query}`, {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        if (!response.ok) throw new Error("History unavailable");
        const payload = await response.json() as { threads?: RecentThread[] };
        if (!Array.isArray(payload.threads)) throw new Error("Invalid history");
        if (!controller.signal.aborted) setThreads(payload.threads);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [brandId, activeThreadId, ready, visible, revision, retry]);

  return <section className="klio-chatkit-recent" aria-label="Недавние диалоги" aria-busy={loading && ready}>
    <h2>Диалоги</h2>
    {threads.length > 0 && <ul>
      {threads.map((thread) => <li key={thread.id}>
        <button type="button" title={thread.title || "Новый диалог"} aria-current={thread.id === activeThreadId ? "page" : undefined} disabled={!ready} onClick={() => onOpen(thread.id)}>
          <span>{thread.title || "Новый диалог"}</span>
          {thread.status === "processing" && <span className="klio-chatkit-recent-busy" aria-label="Готовится ответ">···</span>}
        </button>
      </li>)}
    </ul>}
    {!threads.length && !failed && <p>{loading ? "Загружаем диалоги…" : "Ваши диалоги появятся здесь"}</p>}
    {failed && <div className="klio-chatkit-recent-error" role="status">
      <p>Не удалось обновить список</p>
      <button type="button" onClick={() => setRetry((value) => value + 1)}>Повторить</button>
    </div>}
    <button className="klio-chatkit-all-history" type="button" disabled={!ready} onClick={onHistory}>Вся история</button>
  </section>;
}
