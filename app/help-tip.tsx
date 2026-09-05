"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Site-wide "?" help tooltip: hover or click to open on desktop, tap to
 * expand inline on mobile (see the media query around .help-tip-panel in
 * globals.css). Same interaction/visual language as the brand-profile
 * field help (see profile-field.tsx), generalized so it can sit next to
 * any label or heading, not just inside the brand-profile field grid.
 * text accepts a ReactNode, not just a string, so a caller can embed a
 * real interactive element (e.g. a link into another module) rather than
 * flattening it to inert text - most callers just pass a plain string,
 * which is itself a valid ReactNode.
 */
export function HelpTip({ label, text }: { label: string; text: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pointerType = useRef("mouse");
  const wrap = useRef<HTMLSpanElement>(null);
  const helpId = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return <span className="help-tip" ref={wrap}
    onPointerOut={(event) => {
      if (event.pointerType !== "mouse") return;
      const next = event.relatedTarget;
      if (!(next instanceof Element) || !event.currentTarget.contains(next)) setOpen(false);
    }}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
    <button type="button" className="help-tip-trigger"
      aria-label={`Подсказка: ${label}`} aria-expanded={open} aria-controls={helpId}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setOpen(true); }}
      onPointerDown={(event) => { pointerType.current = event.pointerType; }}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setOpen(true); }}
      onClick={(event) => {
        if (event.detail > 0 && pointerType.current === "mouse") setOpen(true);
        else setOpen((current) => !current);
      }}>
      <span aria-hidden="true">?</span>
    </button>
    <div id={helpId} className="help-tip-panel" hidden={!open}>{text}</div>
  </span>;
}
