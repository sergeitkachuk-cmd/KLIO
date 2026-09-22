"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import type { DialogueImageSource } from "./dialogue-image-source";

export function DialogueImageAttachment({ source, url, busy, onChange, onBusy }: {
  source: DialogueImageSource | null;
  url: string;
  busy: boolean;
  onChange: (source: DialogueImageSource | null) => void;
  onBusy: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const ticket = useRef(0);
  useEffect(() => () => { ticket.current++; }, []);
  return <div className="klio-aui-attachment">
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Загрузить референс" onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      setError("");
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
        setError("Выберите PNG, JPEG или WEBP до 8 МБ."); return;
      }
      const current = ++ticket.current;
      onBusy(true);
      try {
        const form = new FormData(); form.set("file", file);
        const response = await fetch("/api/uploads", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
        const data = await response.json();
        if (!response.ok || !data.url) throw new Error(data.error || "Не удалось загрузить изображение.");
        if (current === ticket.current) onChange({ uploadUrl: data.url, purpose: "reference" });
      } catch (failure) {
        if (current === ticket.current) setError(failure instanceof Error ? failure.message : "Не удалось загрузить изображение.");
      } finally { if (current === ticket.current) onBusy(false); }
    }} />
    {source && url ? <div className="klio-aui-attachment-preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Исходное изображение" />
      <label>Изображение
        <select aria-label="Как использовать изображение" value={source.purpose} disabled={busy} onChange={(event) => onChange({ ...source, purpose: event.target.value as DialogueImageSource["purpose"] })}>
          <option value="edit">Доработать исходник</option>
          <option value="reference">Взять за референс</option>
        </select>
      </label>
      <button type="button" aria-label="Убрать исходное изображение" disabled={busy} onClick={() => onChange(null)}><X size={16} /></button>
    </div> : <button type="button" className="klio-aui-attach-trigger" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={16} />Референс</button>}
    {busy && <small role="status">Загружаем изображение…</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
