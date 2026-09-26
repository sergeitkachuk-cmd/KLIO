"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function DialogueSettingsPopover({ open, onOpenChange, title, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const measure = useCallback(() => {
    if (!trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportBottom = viewportTop + viewportHeight;
    const width = Math.max(0, Math.min(560, viewportWidth - 24));
    const left = Math.max(viewportLeft + 12, Math.min(rect.left, viewportLeft + viewportWidth - width - 12));
    const panelHeight = panel.current?.getBoundingClientRect().height
      ?? Math.min(320, Math.max(0, viewportHeight - 24));
    const safeTop = viewportTop + 12;
    const safeBottom = viewportBottom - 12;
    const above = rect.top - panelHeight - 8;
    const below = rect.bottom + 8;
    const fitsAbove = above >= safeTop;
    const fitsBelow = below + panelHeight <= safeBottom;
    const top = fitsAbove
      ? above
      : fitsBelow
        ? below
        : Math.max(safeTop, safeTop + (safeBottom - safeTop - panelHeight) / 2);
    setPosition((current) => current
      && Math.abs(current.left - left) < 0.5
      && Math.abs(current.top - top) < 0.5
      && Math.abs(current.width - width) < 0.5
      ? current
      : { left, top, width });
  }, []);

  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure, position?.width]);

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
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (panel.current) observer?.observe(panel.current);
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      observer?.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
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
