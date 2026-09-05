"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function ProfileField({ id, label, help, wide, children }: {
  id: string;
  label: string;
  help: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const header = useRef<HTMLDivElement>(null);
  const helpId = `${id}-help`;

  useEffect(() => {
    if (!open) return;
    const close = () => { pinned.current = false; setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const onPointer = (event: PointerEvent) => {
      if (!header.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return <div className={`brand-profile-field${wide ? " wide" : ""}`}>
    <div className="profile-field-heading" ref={header}
      onPointerLeave={() => {
        if (!pinned.current && !header.current?.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          pinned.current = false;
          setOpen(false);
        }
      }}>
      <label htmlFor={id}>{label}</label>
      <button type="button" className="profile-help-trigger"
        aria-label={`Подсказка: ${label}`} aria-expanded={open} aria-controls={helpId}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") setOpen(true); }}
        onFocus={() => { if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) setOpen(true); }}
        onClick={() => { pinned.current = !pinned.current; setOpen(pinned.current); }}>
        <span aria-hidden="true">?</span>
      </button>
      <div id={helpId} className="profile-field-help" hidden={!open}>{help}</div>
    </div>
    {children}
  </div>;
}
