"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { DialogueCard } from "./dialogue-model";

export function DialogueResultPreview({ card, onClose, onImage, actions }: {
  card: DialogueCard;
  onClose: () => void;
  onImage: () => void;
  actions: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const buttons = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);

  return <div className="klio-chatkit-editor-layer">
    <section ref={panel} className="klio-chatkit-editor klio-chatkit-result-preview" role="dialog" aria-modal="true" aria-label="Просмотр результата">
      <header><h2>{card.title}</h2><button type="button" aria-label="Закрыть просмотр" onClick={onClose}>×</button></header>
      <div className="klio-chatkit-result-body">{card.body}</div>
      {card.imageUrl && <button className="klio-chatkit-result-image" type="button" onClick={onImage} aria-label="Открыть изображение целиком">
        {/* eslint-disable-next-line @next/next/no-img-element -- preserve intrinsic proportions of stored images */}
        <img src={card.imageUrl} alt={card.title} />
      </button>}
      <footer>{actions}</footer>
    </section>
  </div>;
}
