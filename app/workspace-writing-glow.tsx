"use client";

import { useEffect } from "react";

/** One caret halo for native workspace fields, without replacing their editing behaviour. */
export function WorkspaceWritingGlow() {
  useEffect(() => {
    const clip = document.createElement("div");
    clip.className = "workspace-writing-glow-clip";
    clip.setAttribute("aria-hidden", "true");
    const halo = document.createElement("span");
    clip.append(halo);
    const measurementHost = document.createElement("div");
    measurementHost.setAttribute("aria-hidden", "true");
    measurementHost.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;contain:strict;visibility:hidden;pointer-events:none;";
    const measurementRoot = measurementHost.attachShadow({ mode: "closed" });
    const mirror = document.createElement("div");
    mirror.style.cssText = "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;overflow-wrap:break-word;";
    measurementRoot.append(mirror);
    document.body.append(clip, measurementHost);
    let styledField: Element | null = null;
    let styledWidth = -1;
    let fieldRadius = "0px";
    let frame = 0;
    const update = () => {
      frame = 0;
      const field = document.activeElement;
      // The effect belongs to writing content, not compact search or metadata inputs.
      const eligible = field instanceof HTMLTextAreaElement
        && !!field.closest(".workspace-shell, .archive-editor-overlay, .publications-editor-modal")
        && !field.closest(".klio-glass-writing-field, #brand-profile, .support-overlay") && !field.readOnly && !field.disabled;
      if (!eligible || field.selectionStart === null || field.selectionStart !== field.selectionEnd) {
        clip.hidden = true;
        return;
      }
      const bounds = field.getBoundingClientRect();
      if (styledField !== field || styledWidth !== bounds.width) {
      const style = getComputedStyle(field);
      for (const name of ["box-sizing", "font-family", "font-size", "font-weight", "font-style", "font-feature-settings", "font-variation-settings", "letter-spacing", "word-spacing", "text-indent", "text-align", "direction", "tab-size", "line-height", "padding", "border-width", "border-style"]) {
        mirror.style.setProperty(name, style.getPropertyValue(name));
      }
      mirror.style.width = `${field.offsetWidth}px`;
      mirror.style.whiteSpace = field instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
      styledField = field; styledWidth = bounds.width; fieldRadius = style.borderRadius;
      }
      mirror.replaceChildren(document.createTextNode(field.value.slice(0, field.selectionStart)));
      const marker = document.createElement("span");
      marker.textContent = field.value.slice(field.selectionStart) || "\u200b";
      mirror.append(marker);
      const point = marker.getClientRects()[0];
      if (!point) { clip.hidden = true; return; }
      const base = mirror.getBoundingClientRect();
      const x = point.left - base.left - field.scrollLeft;
      const y = point.top - base.top - field.scrollTop + point.height / 2;
      clip.hidden = x < 0 || x > bounds.width || y < 0 || y > bounds.height;
      Object.assign(clip.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, borderRadius: fieldRadius });
      Object.assign(halo.style, { left: `${x}px`, top: `${y}px` });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const events = ["focusin", "focusout", "input", "keyup", "click", "selectionchange", "scroll"] as const;
    events.forEach(name => document.addEventListener(name, schedule, true));
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      events.forEach(name => document.removeEventListener(name, schedule, true));
      window.removeEventListener("resize", schedule);
      clip.remove(); measurementHost.remove();
    };
  }, []);
  return null;
}
