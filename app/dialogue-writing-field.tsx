"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

type Caret = { left: number; top: number; height: number };

/** Measure a textarea's insertion point without changing its native editing behavior. */
export function DialogueWritingField({ inputRef, value, children }: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  children: ReactNode;
}) {
  const field = useRef<HTMLDivElement>(null);
  const refresh = useRef<(() => void) | null>(null);
  const caretElement = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    const container = field.current;
    const caret = caretElement.current;
    if (!input || !container || !caret) return;
    const setCaret = (position: Caret | null) => {
      container.classList.toggle("has-glowing-caret", !!position);
      caret.style.display = position ? "block" : "none";
      if (position) {
        caret.style.transform = `translate3d(${position.left}px,${position.top}px,0)`;
        caret.style.height = `${position.height}px`;
      }
    };
    const measurementHost = document.createElement("div");
    measurementHost.setAttribute("aria-hidden", "true");
    measurementHost.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;contain:strict;visibility:hidden;pointer-events:none;";
    const measurementRoot = measurementHost.attachShadow({ mode: "closed" });
    const mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    mirror.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden;";
    measurementRoot.append(mirror);
    document.body.appendChild(measurementHost);
    let styledWidth = -1;
    let lineHeight = 24;
    let frame = 0;
    let composing = false;
    const measure = () => {
      frame = 0;
      if (composing || document.activeElement !== input || input.selectionStart !== input.selectionEnd) {
        setCaret(null);
        return;
      }
      if (styledWidth !== input.clientWidth) {
      const style = getComputedStyle(input);
      for (const property of ["box-sizing", "font-family", "font-size", "font-weight", "font-style", "font-variant", "font-feature-settings", "font-variation-settings", "line-height", "letter-spacing", "word-spacing", "text-transform", "text-indent", "text-align", "direction", "tab-size", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-style"]) {
        mirror.style.setProperty(property, style.getPropertyValue(property));
      }
      mirror.style.boxSizing = "border-box";
      mirror.style.width = `${input.clientWidth + input.clientLeft + parseFloat(style.borderRightWidth)}px`;
      styledWidth = input.clientWidth;
      lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
      }
      // Preserve the text after the caret so wrapping agrees with the real line.
      mirror.replaceChildren(document.createTextNode(input.value.slice(0, input.selectionStart)));
      const marker = document.createElement("span");
      marker.textContent = input.value.slice(input.selectionStart) || "\u200b";
      mirror.appendChild(marker);
      const rect = marker.getClientRects()[0];
      if (!rect) { setCaret(null); return; }
      const mirrorRect = mirror.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const fieldRect = container.getBoundingClientRect();
      const height = lineHeight;
      const left = rect.left - mirrorRect.left - input.scrollLeft;
      const top = rect.top - mirrorRect.top - input.scrollTop;
      const visible = left >= input.clientLeft && left <= input.clientWidth + input.clientLeft && top + rect.height > 0 && top < input.clientHeight;
      setCaret(visible ? {
        left: inputRect.left - fieldRect.left + left,
        top: inputRect.top - fieldRect.top + top - (height - rect.height) / 2,
        height,
      } : null);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    refresh.current = schedule;
    const startComposition = () => { composing = true; schedule(); };
    const endComposition = () => { composing = false; schedule(); };
    const events = ["input", "focus", "blur", "click", "keyup", "select", "scroll"] as const;
    events.forEach(event => input.addEventListener(event, schedule));
    input.addEventListener("compositionstart", startComposition);
    input.addEventListener("compositionend", endComposition);
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(input);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      refresh.current = null;
      observer.disconnect();
      events.forEach(event => input.removeEventListener(event, schedule));
      input.removeEventListener("compositionstart", startComposition);
      input.removeEventListener("compositionend", endComposition);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("resize", schedule);
      measurementHost.remove();
    };
  }, [inputRef]);

  useEffect(() => { refresh.current?.(); }, [value]);

  return <div ref={field} className="klio-glass-writing-field">
    {children}
    <span ref={caretElement} aria-hidden="true" className="klio-glass-caret" style={{ left: 0, top: 0, display: "none" }}><i/></span>
  </div>;
}
