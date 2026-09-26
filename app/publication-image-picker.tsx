"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { focusListboxOption, handleListboxKeyDown } from "./listbox-navigation";

// Replaces an always-open, unstyled thumbnail strip (site owner: "это
// реализовано ужасно... там всё криво переполняется" - .publications-
// material-image-list had no CSS at all) and a "Из материалов" button that
// silently grabbed the first matching image instead of letting anyone pick
// one. Same portal/measure approach as ModuleSelect (see its own comment):
// the publications editor modal scrolls its own content
// (overflow: auto), so a plain position: absolute popover would get
// clipped or scroll away from its trigger; portaling to document.body with
// position: fixed keeps it anchored to the button regardless.
export function PublicationImagePicker({ label, items, activeUrl, onSelect }: {
  label: string;
  items: { id: string; title: string; imageUrl: string }[];
  activeUrl: string;
  onSelect: (item: { id: string; imageUrl: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Decided once when it opens, not re-decided on scroll - see ModuleSelect's
  // own note on why (avoids the menu flipping side mid-scroll).
  const openUpRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const closeOnFocusOutside = (event: FocusEvent) => {
      const target = event.target as Node;
      if (target === triggerRef.current || !listRef.current?.contains(target)) setOpen(false);
    };
    const measureMenu = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const edgeGap = 12;
      const maxMenuHeight = 360;
      const openUp = openUpRef.current;
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - edgeGap);
      const spaceAbove = Math.max(0, rect.top - edgeGap);
      const maxHeight = Math.max(160, Math.min(maxMenuHeight, openUp ? spaceAbove : spaceBelow));
      setMenuRect(openUp
        ? { bottom: window.innerHeight - rect.top + 8, left: rect.left, width: Math.max(rect.width, 280), maxHeight }
        : { top: rect.bottom + 8, left: rect.left, width: Math.max(rect.width, 280), maxHeight });
    };
    const repositionOnScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return;
      measureMenu();
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("focusin", closeOnFocusOutside);
    window.addEventListener("scroll", repositionOnScroll, true);
    window.addEventListener("resize", repositionOnScroll);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("focusin", closeOnFocusOutside);
      window.removeEventListener("scroll", repositionOnScroll, true);
      window.removeEventListener("resize", repositionOnScroll);
    };
  }, [open]);

  useEffect(() => {
    if (open && items.length) focusListboxOption(listRef.current, activeUrl);
  }, [activeUrl, items.length, open]);

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const edgeGap = 12;
      const maxMenuHeight = 360;
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - edgeGap);
      const spaceAbove = Math.max(0, rect.top - edgeGap);
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      openUpRef.current = openUp;
      const maxHeight = Math.max(160, Math.min(maxMenuHeight, openUp ? spaceAbove : spaceBelow));
      setMenuRect(openUp
        ? { bottom: window.innerHeight - rect.top + 8, left: rect.left, width: Math.max(rect.width, 280), maxHeight }
        : { top: rect.bottom + 8, left: rect.left, width: Math.max(rect.width, 280), maxHeight });
    }
    setOpen((current) => !current);
  }

  return <div className="pub-image-picker" ref={containerRef}>
    <button type="button" ref={triggerRef} className="button ghost pub-image-picker-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={toggleOpen} onKeyDown={(event) => {
      if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        toggleOpen();
      }
    }}>
      {label}
    </button>
    {open && menuRect && createPortal(
      <div id={listId} className="pub-image-picker-list" role="listbox" aria-label={label} ref={listRef} onKeyDown={(event) => handleListboxKeyDown(event, listRef.current, () => setOpen(false), triggerRef.current)} style={{ position: "fixed", top: menuRect.top, bottom: menuRect.bottom, left: menuRect.left, width: menuRect.width, maxHeight: menuRect.maxHeight }}>
        {items.map((item) => (
          <button data-listbox-value={item.imageUrl} type="button" role="option" tabIndex={-1} aria-selected={activeUrl === item.imageUrl} className={activeUrl === item.imageUrl ? "active" : ""} onClick={() => { onSelect(item); setOpen(false); triggerRef.current?.focus(); }} key={item.id}>
            <Image unoptimized width={72} height={72} src={item.imageUrl} alt={item.title} />
            <span>{item.title || "Изображение"}</span>
          </button>
        ))}
      </div>,
      document.body,
    )}
  </div>;
}
