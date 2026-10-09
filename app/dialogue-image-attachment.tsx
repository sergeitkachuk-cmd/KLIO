"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import type { DialogueImageSource } from "./dialogue-image-source";
import { ModuleSelect } from "./module-select";

export function DialogueImageAttachment({ source, url, busy, onChange, onBusy, lockedPurpose }: {
  source: DialogueImageSource | null;
  url: string;
  busy: boolean;
  onChange: (source: DialogueImageSource | null) => void;
  onBusy: (busy: boolean) => void;
  lockedPurpose?: DialogueImageSource["purpose"];
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const ticket = useRef(0);
  // The person's own file, shown straight from memory - the uploaded copy
  // only round-trips through our server and S3, which on a large photo
  // painted line by line instead of appearing at once.
  const [local, setLocal] = useState<{ blobUrl: string; uploadUrl: string } | null>(null);
  const localRef = useRef(local);
  useEffect(() => () => {
    ticket.current++;
    if (localRef.current) URL.revokeObjectURL(localRef.current.blobUrl);
  }, []);
  function replaceLocal(next: { blobUrl: string; uploadUrl: string } | null) {
    if (localRef.current && localRef.current.blobUrl !== next?.blobUrl) URL.revokeObjectURL(localRef.current.blobUrl);
    localRef.current = next;
    setLocal(next);
  }
  const uploading = Boolean(local && !local.uploadUrl && busy);
  const displayUrl = local && (uploading || local.uploadUrl === url) ? local.blobUrl : url;
  return <div className="klio-aui-attachment">
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Загрузить референс" onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      setError("");
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) {
        setError("Выберите PNG, JPEG или WEBP до 15 МБ."); return;
      }
      const current = ++ticket.current;
      const blobUrl = URL.createObjectURL(file);
      replaceLocal({ blobUrl, uploadUrl: "" });
      onBusy(true);
      try {
        const form = new FormData(); form.set("file", file); form.set("purpose", "image-source");
        const response = await fetch("/api/uploads", { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
        const data = await response.json();
        if (!response.ok || !data.url) throw new Error(data.error || "Не удалось загрузить изображение.");
        if (current === ticket.current) {
          replaceLocal({ blobUrl, uploadUrl: data.url });
          onChange({ uploadUrl: data.url, purpose: lockedPurpose || "reference" });
        }
      } catch (failure) {
        if (current === ticket.current) {
          replaceLocal(null);
          setError(failure instanceof Error ? failure.message : "Не удалось загрузить изображение.");
        }
      } finally { if (current === ticket.current) onBusy(false); }
    }} />
    {(source && url) || uploading ? <div className="klio-aui-attachment-preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={displayUrl} alt="Исходное изображение" />
      {lockedPurpose || !source ? <small className="klio-aui-attachment-purpose-note">Референс</small> : <div className="klio-aui-attachment-purpose">
        <ModuleSelect variant="chatkit" label="Как использовать изображение" value={source.purpose} disabled={busy} options={[
          { value: "edit", label: "Доработать исходник" },
          { value: "reference", label: "Взять за основу" },
        ]} onChange={(purpose) => onChange({ ...source, purpose: purpose as DialogueImageSource["purpose"] })} />
      </div>}
      <button type="button" aria-label="Убрать исходное изображение" disabled={busy} onClick={() => { replaceLocal(null); onChange(null); }}><X size={16} /></button>
    </div> : <button type="button" className="klio-aui-attach-trigger" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={16} />Референс</button>}
    {busy && <small role="status">Загружаем изображение…</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
