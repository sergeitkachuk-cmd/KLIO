"use client";

import { Pencil, Check, ArrowUpRight, Quote, MapPin, Sparkles, ShieldCheck, Users, Package, Fingerprint } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function ProfileField({ id, label, help, wide, value, children }: {
  id: string;
  label: string;
  help: string;
  wide?: boolean;
  value?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const listStyle = ["brand-advantages", "brand-products", "brand-services", "brand-proof", "brand-restrictions", "brand-prohibited"].includes(id);
  const entries = (value || "").split(/\n+|;\s*/).map(text => text.trim()).filter(Boolean);
  const Mark = id === "brand-audience" ? Users : id === "brand-geography" ? MapPin : id === "brand-voice" ? Quote : id === "brand-restrictions" ? ShieldCheck : id === "brand-products" ? Package : id === "brand-positioning" ? Fingerprint : Sparkles;
  useEffect(() => {
    if (editing) {
      const field = document.getElementById(id);
      field?.focus();
      window.dispatchEvent(new Event("resize"));
    }
  }, [editing, id]);
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

  return <div data-brand-motion data-field={id} className={`brand-profile-field${wide ? " wide" : ""}${editing ? " is-editing" : ""}${value !== undefined ? " has-editorial-preview" : ""}`}>
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
      {value !== undefined && <Mark className="brand-field-symbol" size={16} aria-hidden="true"/>}
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
    {value !== undefined ? <>
      <button className="brand-field-edit" type="button" aria-label={editing ? `Готово: ${label}` : `Редактировать: ${label}`} onClick={() => setEditing(current => !current)}>{editing ? <Check size={14}/> : <Pencil size={13}/>}</button>
      {!editing && <div className={`brand-editorial-value${listStyle ? " is-list" : ""}${id === "brand-vocabulary" ? " is-vocabulary" : ""}`}>
        {!value.trim() ? <button className="brand-field-empty" type="button" onClick={() => setEditing(true)}>Добавить {label.toLocaleLowerCase("ru-RU")} <ArrowUpRight size={16}/></button>
          : listStyle ? <ul>{entries.map((text, index) => <li key={index}><span className="brand-list-marker" aria-hidden="true">{id === "brand-restrictions" || id === "brand-prohibited" ? "−" : "✓"}</span><span>{text}</span></li>)}</ul>
          : id === "brand-vocabulary" ? <div className="brand-word-pills">{entries.map((text, index) => <span key={index}>{text}</span>)}</div>
          : <p>{value}</p>}
      </div>}
      <div className="brand-field-editor" hidden={!editing}>{children}</div>
      {id === "brand-cta" && !editing && <ArrowUpRight className="brand-cta-arrow" size={32} aria-hidden="true"/>}
    </> : children}
  </div>;
}
