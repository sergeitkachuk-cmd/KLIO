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
  const pointerType = useRef("mouse");
  const header = useRef<HTMLDivElement>(null);
  const helpId = `${id}-help`;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
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
      onPointerOut={(event) => {
        if (event.pointerType !== "mouse") return;
        const next = event.relatedTarget;
        if (!(next instanceof Element) || !event.currentTarget.contains(next) ||
          !next.closest(".profile-help-trigger, .profile-field-help")) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}>
      <label htmlFor={id}>{label}</label>
      <button type="button" className="profile-help-trigger"
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
      <div id={helpId} className="profile-field-help" hidden={!open}>{help}</div>
    </div>
    {children}
  </div>;
}
