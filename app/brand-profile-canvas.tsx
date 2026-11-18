"use client";

import { useEffect, useRef, type ReactNode } from "react";
import "./brand-profile-canvas.css";

export function BrandProfileCanvas({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cards = Array.from(element.querySelectorAll<HTMLElement>("[data-brand-motion]"));
    const positions = new WeakMap<EventTarget, number>();
    positions.set(document, window.scrollY);
    for (let parent: Element | null = element; parent; parent = parent.parentElement) positions.set(parent, parent.scrollTop);
    let frame = 0;
    let impulse = 0;
    const reset = () => cards.forEach(card => card.style.removeProperty("transform"));
    const animate = () => {
      impulse *= 0.86;
      cards.forEach((card, index) => {
        const rect = card.getBoundingClientRect();
        if (rect.bottom < -80 || rect.top > window.innerHeight + 80 || card.contains(document.activeElement)) {
          card.style.removeProperty("transform"); return;
        }
        const strength = 0.65 + (index % 3) * 0.18;
        const wave = impulse * strength;
        card.style.transform = `translateY(${-wave * 0.2}px) scale(${1 - Math.abs(wave) * 0.00015}, ${1 + Math.abs(wave) * 0.00045})`;
      });
      if (Math.abs(impulse) > 0.1) frame = requestAnimationFrame(animate);
      else { frame = 0; reset(); }
    };
    const onScroll = (event: Event) => {
      if (preference.matches) return;
      const target = event.target;
      if (!target || (target instanceof Element && element.contains(target))) return;
      const position = target instanceof Element ? target.scrollTop : window.scrollY;
      const last = positions.get(target) ?? position;
      positions.set(target, position);
      impulse = Math.max(-14, Math.min(14, impulse + (position - last) * 0.2));
      if (!frame && Math.abs(impulse) > 0.1) frame = requestAnimationFrame(animate);
    };
    const onPreference = () => { cancelAnimationFrame(frame); frame = 0; impulse = 0; reset(); };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    preference.addEventListener("change", onPreference);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      preference.removeEventListener("change", onPreference);
      cancelAnimationFrame(frame); reset();
    };
  }, []);
  return <div ref={root} className="brand-canvas">{children}</div>;
}
