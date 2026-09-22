"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { DialogueThread } from "./dialogue-model";

export type ThreadAction = "rename" | "delete";

export function DialogueThreadMenu({ title, disabled, onAction }: {
  title: string;
  disabled: boolean;
  onAction: (action: ThreadAction) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!position) return;
    panel.current?.querySelector("button")?.focus();
    const close = () => setPosition(null);
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); trigger.current?.focus(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const buttons = [...(panel.current?.querySelectorAll("button") || [])];
        const current = buttons.findIndex((button) => button === document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault(); buttons[next]?.focus();
      }
      if (event.key === "Tab") close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [position]);

  return <>
    <button ref={trigger} className="klio-chatkit-thread-more" type="button" disabled={disabled}
      aria-label={`Действия диалога «${title}»`} aria-haspopup="menu" aria-expanded={Boolean(position)} aria-controls={position ? id : undefined}
      onClick={() => {
        if (position) { setPosition(null); return; }
        const rect = trigger.current!.getBoundingClientRect();
        setPosition({ left: Math.max(12, Math.min(rect.right - 184, window.innerWidth - 196)),
          top: Math.max(12, Math.min(rect.bottom + 4, window.innerHeight - 104)) });
      }}><span aria-hidden="true">⋯</span></button>
    {position && createPortal(<div id={id} ref={panel} className="klio-chatkit-thread-menu" role="menu" aria-label="Действия с диалогом" style={position}>
      {(["rename", "delete"] as const).map((action) => <button key={action} role="menuitem" type="button" data-action={action} onClick={() => {
        setPosition(null); trigger.current?.focus(); onAction(action);
      }}>{action === "rename" ? "Переименовать" : "Удалить"}</button>)}
    </div>, document.body)}
  </>;
}

export function DialogueThreadDialog({ thread, action, onClose, onSubmit }: {
  thread: DialogueThread;
  action: ThreadAction;
  onClose: () => void;
  onSubmit: (title: string) => Promise<void>;
}) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const [title, setTitle] = useState(thread.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const input = panel.current?.querySelector("input");
    if (input) { input.focus(); input.select(); }
    else panel.current?.querySelector("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
      }
      if (event.key === "Tab") {
        const elements = [...(panel.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)") || [])];
        if (!elements.length) { event.preventDefault(); return; }
        const next = event.shiftKey ? elements.at(-1)! : elements[0];
        if (document.activeElement === (event.shiftKey ? elements[0] : elements.at(-1)) || !panel.current?.contains(document.activeElement)) {
          event.preventDefault(); next.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || (action === "rename" && !title.trim())) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await onSubmit(title.trim()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось изменить диалог."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return createPortal(<div className="klio-chatkit-thread-dialog-layer">
    <section ref={panel} className="klio-chatkit-thread-dialog" role={action === "delete" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={action === "delete" ? `${id}-description` : undefined} aria-busy={busy}>
      <h2 id={`${id}-title`}>{action === "rename" ? "Переименовать диалог" : "Удалить диалог?"}</h2>
      <form onSubmit={(event) => void submit(event)}>
        {action === "rename" ? <label>Название<input aria-label="Название диалога" value={title} maxLength={80} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label>
          : <p id={`${id}-description`}>Диалог «{thread.title}» и несохранённые результаты будут удалены без возможности восстановления. Тексты и картинки, сохранённые в «Материалах», останутся.</p>}
        {error && <p className="klio-chatkit-thread-error" role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>Отмена</button>
          <button type="submit" data-action={action} disabled={busy || (action === "rename" && !title.trim())}>{busy ? "Подождите…" : action === "rename" ? "Сохранить" : "Удалить"}</button>
        </footer>
      </form>
    </section>
  </div>, document.body);
}
