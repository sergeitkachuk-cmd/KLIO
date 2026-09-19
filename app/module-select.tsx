"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpTip } from "./help-tip";

// Custom dropdown matching the brand-switcher's visual language (trigger +
// floating list, checkmark on the active item) instead of a native <select>
// — a native <select>'s own option-list popup can't be restyled to match
// the app's dark theme (site owner: a screenshot of the stock white/blue
// browser popup next to "в соответствии со стилем нашем"). The list
// portals to document.body and positions itself via a measured rect —
// several of this component's homes (e.g. the generator's brief panel)
// have overflow:hidden ancestors for their own rounded-corner/background
// clipping, which would otherwise cut the open list off.
//
// `variant`, when set, adds a `module-select-<variant>` class to both the
// trigger's own container AND the portaled list — the list escapes the
// normal DOM ancestry once portaled to document.body, so an ancestor
// selector like ".workspace-shell.is-dialogue .module-select-list" can
// never reach it; this lets a caller in a differently-themed surface
// (dialogue mode's own --chat-* palette) restyle both pieces directly.
export function ModuleSelect({ label, value, options, onChange, help, variant }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  help?: string;
  variant?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Which side the menu opens on is decided once, when it opens (below,
  // unless there's more room above) — not re-decided on every scroll event.
  // Re-deciding on scroll used to flip the menu between above and below the
  // trigger mid-scroll as the available space above/below crossed the same
  // threshold that chose the side in the first place, reading as the menu
  // randomly jumping (site owner: "скачет вверх... прыгает вниз если
  // прокрутить"). Scrolling should only ever slide the menu to keep
  // tracking the trigger on whichever side it already committed to.
  const openUpRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Reposition on scroll instead of closing — the list is portaled and
    // position:fixed, so it needs to track the trigger if the page scrolls.
    // Scrolling *inside* the option list itself (a capture-phase scroll
    // event bubbling up from listRef) must not close the menu — that used
    // to make picking a style/length impossible to scroll to.
    const measureMenu = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const edgeGap = 12;
      const maxMenuHeight = 480;
      const openUp = openUpRef.current;
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - edgeGap);
      const spaceAbove = Math.max(0, rect.top - edgeGap);
      const maxHeight = Math.max(120, Math.min(maxMenuHeight, openUp ? spaceAbove : spaceBelow));
      setMenuRect({
        top: openUp ? Math.max(edgeGap, rect.top - maxHeight) : rect.bottom + 8,
        left: rect.left,
        width: rect.width,
        maxHeight,
      });
    };
    const repositionOnScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return;
      measureMenu();
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", repositionOnScroll, true);
    window.addEventListener("resize", repositionOnScroll);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", repositionOnScroll, true);
      window.removeEventListener("resize", repositionOnScroll);
    };
  }, [open]);

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const edgeGap = 12;
      const maxMenuHeight = 480;
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - edgeGap);
      const spaceAbove = Math.max(0, rect.top - edgeGap);
      const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
      openUpRef.current = openUp;
      const maxHeight = Math.max(120, Math.min(maxMenuHeight, openUp ? spaceAbove : spaceBelow));
      setMenuRect({ top: openUp ? Math.max(edgeGap, rect.top - maxHeight) : rect.bottom + 8, left: rect.left, width: rect.width, maxHeight });
    }
    setOpen((current) => !current);
  }

  const activeOption = options.find((item) => item.value === value);
  const variantClass = variant ? `module-select-${variant}` : "";

  return <div className={`field module-select ${variantClass} ${open ? "is-open" : ""}`} ref={containerRef}>
    <span className="field-label-help">{label}{help && <HelpTip label={label} text={help}/>}</span>
    <button type="button" ref={triggerRef} className="module-select-trigger" onClick={toggleOpen} aria-haspopup="listbox" aria-expanded={open}>
      <b>{activeOption?.label || value}</b>
      <em className="ui-chevron" aria-hidden="true" />
    </button>
    {open && menuRect && createPortal(
      <div className={`module-select-list ${variantClass}`} role="listbox" aria-label={label} ref={listRef} style={{ position: "fixed", top: menuRect.top, left: menuRect.left, width: menuRect.width, maxHeight: menuRect.maxHeight }}>
        {options.map((item) => <button type="button" role="option" aria-selected={item.value === value} className={item.value === value ? "active" : ""} onClick={() => { onChange(item.value); setOpen(false); }} key={item.value}>
          <span>{item.label}</span><em>{item.value === value ? "✓" : ""}</em>
        </button>)}
      </div>,
      document.body,
    )}
  </div>;
}
