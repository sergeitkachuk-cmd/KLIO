"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function DialogueModal({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const panel = useRef<HTMLElement>(null);
  const latest = useRef({ onClose, busy });
  useEffect(() => { latest.current = { onClose, busy }; }, [onClose, busy]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input,button,textarea,select")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !latest.current.busy) { event.preventDefault(); latest.current.onClose(); }
      if (event.key !== "Tab") return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]") || []);
      const first = items[0], last = items.at(-1);
      if (!first || !last) return;
      if (!panel.current?.contains(document.activeElement) || document.activeElement === (event.shiftKey ? first : last)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="klio-chatkit-thread-dialog-layer">
    <section ref={panel} className="klio-chatkit-thread-dialog" role="dialog" aria-modal="true" aria-label={title} aria-busy={busy}>
      <header className="klio-aui-modal-head"><h2>{title}</h2><button type="button" disabled={busy} aria-label="Закрыть" onClick={onClose}>×</button></header>
      {children}
    </section>
  </div>, document.body);
}
