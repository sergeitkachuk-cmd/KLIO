"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function DialogueSettingsPopover({ open, onOpenChange, title, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; bottom: number; width: number; maxHeight: number } | null>(null);
  const measure = useCallback(() => {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const width = Math.min(360, (viewport?.width || window.innerWidth) - 24);
    setPosition({
      left: Math.max(left + 12, Math.min(rect.left, left + (viewport?.width || window.innerWidth) - width - 12)),
      bottom: window.innerHeight - rect.top + 8,
      width,
      maxHeight: Math.max(0, Math.min(420, rect.top - top - 20)),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      // ModuleSelect renders its options in a separate portal above this one.
      if (trigger.current?.contains(target) || panel.current?.contains(target)
        || target.closest?.(".module-select-list.module-select-chatkit")) return;
      onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The first Escape closes a nested option list; the next closes settings.
      if (document.querySelector(".module-select-list.module-select-chatkit")) return;
      onOpenChange(false);
      trigger.current?.focus();
    };
    // Focus entering the external ChatKit iframe is not a document click.
    const blur = () => {
      queueMicrotask(() => {
        if (document.activeElement?.closest("openai-chatkit")) onOpenChange(false);
      });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [open, measure, onOpenChange]);

  return <>
    <button ref={trigger} type="button" className="klio-chatkit-settings-toggle" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? "chatkit-generation-settings" : undefined} onClick={() => { if (!open) measure(); onOpenChange(!open); }}>
      <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h14M3 15h14" /><circle cx="7" cy="5" r="2" fill="var(--ck-bg)" /><circle cx="13" cy="15" r="2" fill="var(--ck-bg)" /></svg>
      <span>Настройки</span><span aria-hidden="true">{open ? "⌄" : "⌃"}</span>
    </button>
    {open && position && createPortal(<div ref={panel} id="chatkit-generation-settings" role="dialog" aria-label={title} className="klio-chatkit-settings klio-chatkit-settings-popover" style={position}>
      <h2>{title}</h2>
      <div className="klio-chatkit-settings-grid">{children}</div>
    </div>, document.body)}
  </>;
}
