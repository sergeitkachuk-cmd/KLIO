"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DialogueThread } from "./dialogue-model";
import { DialogueModal } from "./dialogue-modal";
import { dialogueRequest } from "./dialogue-session";

export function DialogueHistory({ brandId, onOpen, onClose }: { brandId: string; onOpen: (id: string) => void; onClose: () => void }) {
  const [rows, setRows] = useState<DialogueThread[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(false);
  const lock = useRef(false);
  const load = useCallback(async (before?: string) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const query = new URLSearchParams();
      if (brandId) query.set("brandId", brandId);
      if (before) query.set("before", before);
      const payload = await dialogueRequest<{ threads: DialogueThread[]; next: string | null }>(`/api/dialogue?${query}`);
      if (live.current) {
        setRows((current) => [...new Map((before ? [...current, ...payload.threads] : payload.threads).map((row) => [row.id, row])).values()]);
        setNext(payload.next);
      }
    } catch (caught) { if (live.current) setError(caught instanceof Error ? caught.message : "Не удалось открыть историю."); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  }, [brandId]);
  useEffect(() => { live.current = true; const timer = setTimeout(() => { void load(); }, 0); return () => { live.current = false; clearTimeout(timer); }; }, [load]);
  return <DialogueModal title="История диалогов" onClose={onClose}>
    <ul className="klio-aui-history-list">{rows.map((row) => <li key={row.id}><button type="button" onClick={() => onOpen(row.id)}>{row.title || "Новый диалог"}</button></li>)}</ul>
    {busy && <p role="status">Загружаем…</p>}
    {!busy && !rows.length && !error && <p>Пока нет диалогов</p>}
    {error && <p role="alert">{error}</p>}
    {(next || error) && <button type="button" disabled={busy} onClick={() => void load(next || undefined)}>{error ? "Повторить" : "Загрузить ещё"}</button>}
  </DialogueModal>;
}
