"use client";

import { Children, isValidElement, useEffect, useRef, type ReactNode } from "react";
import "./content-plan-deck.css";

/** Viewport-based reveal with a fully open interval for reading each topic. */
export function ContentPlanDeck({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const cardKeys = Children.toArray(children).map(child => isValidElement(child) ? child.key : "").join("|");
  useEffect(() => {
    const deck = root.current;
    if (!deck) return;
    const cards = Array.from(deck.querySelectorAll<HTMLElement>(".content-plan-item"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let previewHeights: number[] = [];
    let previousWidth = 0;
    let manual: number | null = null;
    const measure = () => {
      previewHeights = cards.map(card => card.querySelector<HTMLElement>(".content-plan-focus-inner")?.scrollHeight || 0);
    };
    const paint = () => {
      frame = 0;
      const rect = deck.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(deck).rowGap) || 12;
      const clamp = (value: number) => Math.max(0, Math.min(1, value));
      const ease = (value: number) => { const p = clamp(value); return p * p * (3 - 2 * p); };
      const enterStart = innerHeight * 0.62;
      const enterEnd = innerHeight * 0.3;
      let top = rect.top;
      const amounts: number[] = [];
      cards.forEach((card, index) => {
        const headerHeight = card.querySelector<HTMLElement>(".content-plan-item-main")?.offsetHeight || 132;
        const briefHeight = card.querySelector<HTMLElement>(".content-plan-brief")?.offsetHeight || 0;
        const previewHeight = previewHeights[index] || 0;
        const fullHeight = headerHeight + previewHeight + briefHeight;
        // Hold until the lower content has reached a comfortable reading position.
        const leaveStart = -Math.max(48, fullHeight - innerHeight * 0.65);
        const leaveDistance = Math.max(180, innerHeight * 0.28);
        // The entire closed header is visible before its content starts opening.
        const revealStart = Math.min(enterStart, innerHeight - headerHeight - 64);
        const entering = ease((revealStart - top) / Math.max(1, revealStart - enterEnd));
        const leaving = ease((top - (leaveStart - leaveDistance)) / leaveDistance);
        let amount = manual !== null ? (manual === index ? 1 : 0) : entering * leaving;
        if (reduced.matches) amount = amount >= 0.5 ? 1 : 0;
        // Resolve positions from top to bottom; a card never measures its own
        // animated height, so opening cannot trigger an oscillating reflow.
        top += headerHeight + briefHeight + amount * previewHeight + gap + 2;
        amounts.push(amount);
      });
      // Adjacent previews share one opening: the incoming topic displaces
      // the outgoing one instead of leaving both fully expanded.
      let remaining = 1;
      for (let index = amounts.length - 1; index >= 0; index--) {
        amounts[index] = Math.min(amounts[index], remaining);
        remaining = Math.max(0, remaining - amounts[index]);
      }
      cards.forEach((card, index) => {
        const amount = amounts[index];
        const previewHeight = previewHeights[index] || 0;
        const region = card.querySelector<HTMLElement>(".content-plan-focus");
        region?.style.setProperty("--topic-height", `${amount * previewHeight}px`);
        region?.style.setProperty("--topic-progress", String(amount));
        card.dataset.scrollActive = String(amount > 0.005);
        card.querySelector("[data-topic-toggle]")?.setAttribute("aria-expanded", String(amount > 0.05));
        region?.setAttribute("aria-hidden", String(amount <= 0.05));
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const onScroll = (event: Event) => {
      if (event.target instanceof Element && deck.contains(event.target)) return;
      const focused = document.activeElement;
      if (focused instanceof Element && deck.contains(focused) && focused.matches("input,select,textarea,[role=combobox]")) return;
      manual = null;
      schedule();
    };
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("[data-topic-toggle]");
      if (!button) return;
      const index = cards.indexOf(button.closest<HTMLElement>(".content-plan-item")!);
      if (index < 0) return;
      const amount = Number(cards[index].querySelector<HTMLElement>(".content-plan-focus")?.style.getPropertyValue("--topic-progress") || 0);
      manual = amount >= 0.99 ? -1 : index;
      schedule();
    };
    const observer = new ResizeObserver(([entry]) => {
      if (Math.abs(entry.contentRect.width - previousWidth) < 1) return;
      previousWidth = entry.contentRect.width;
      measure(); schedule();
    });
    observer.observe(deck);
    measure(); paint();
    let cancelled = false;
    document.fonts.ready.then(() => { if (!cancelled) { measure(); schedule(); } });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    deck.addEventListener("click", onClick);
    reduced.addEventListener("change", schedule);
    return () => {
      cancelled = true; cancelAnimationFrame(frame); observer.disconnect();
      document.removeEventListener("scroll", onScroll, true); deck.removeEventListener("click", onClick);
      reduced.removeEventListener("change", schedule);
    };
  }, [cardKeys]);
  return <div className="content-plan-list content-plan-deck" ref={root}>{children}</div>;
}
