"use client";

import { useEffect, useRef } from "react";
import "./image-creation-flow.css";

/** Purely decorative feedback: no prompt content or React updates per keystroke. */
export function ImageCreationFlow({ busy }: { busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current?.closest(".image-generator-layout");
    const form = root?.querySelector(".image-generator-form");
    if (!root || !form) return;
    let timer: ReturnType<typeof setTimeout>;
    const activate = () => {
      root.setAttribute("data-flow-active", "true");
      clearTimeout(timer);
      timer = setTimeout(() => root.removeAttribute("data-flow-active"), 1500);
    };
    form.addEventListener("input", activate);
    form.addEventListener("change", activate);
    form.addEventListener("click", activate);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("input", activate);
      form.removeEventListener("change", activate);
      form.removeEventListener("click", activate);
      root.removeAttribute("data-flow-active");
    };
  }, []);
  return <div ref={ref} className="image-creation-flow" data-busy={busy} aria-hidden="true">
    <svg viewBox="0 0 100 600" fill="none" preserveAspectRatio="none">
      <path className="creation-flow-thread" d="M50 0 C20 110 80 180 50 300 S20 490 50 600"/>
      <path className="creation-flow-trace" d="M50 0 C20 110 80 180 50 300 S20 490 50 600"/>
      {[190, 300, 410].map((y, index) => <g key={y} style={{ animationDelay: `${index * .35}s` }} className="creation-flow-crossing">
        <path d={`M0 ${y-28} C35 ${y-28} 35 ${y+28} 100 ${y+28}`}/>
        <circle r="2.5"><animateMotion dur="1.8s" begin={`${index * .35}s`} repeatCount="indefinite" path={`M0 ${y-28} C35 ${y-28} 35 ${y+28} 100 ${y+28}`}/></circle>
      </g>)}
    </svg>
    <span className="creation-flow-core">✦</span>
  </div>;
}
