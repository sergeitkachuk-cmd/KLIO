"use client";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/** Extra scroll room holds the outgoing panel while the following panel covers it. */
export function ScrollScene({ children, order, dwell = false, last = false }: {children: ReactNode; order: number; dwell?: boolean; last?: boolean}) {
  const stage=useRef<HTMLDivElement>(null);
  const panel=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!stage.current||!panel.current)return;
    const outer=stage.current,inner=panel.current;
    const measure=()=>outer.style.setProperty("--scene-height",`${inner.getBoundingClientRect().height}px`);
    const observer=new ResizeObserver(measure);observer.observe(inner);measure();
    return()=>observer.disconnect();
  },[]);
  return <div ref={stage} className={`kl-scene-stage${dwell?" kl-scene-dwell":""}${last?" kl-scene-last":""}`} style={{"--scene-order":order} as CSSProperties}><div ref={panel} className="kl-scene-panel">{children}</div></div>;
}
