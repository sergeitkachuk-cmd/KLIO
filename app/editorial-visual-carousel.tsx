"use client";
import { useRef, useState, type ReactNode, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "./editorial-motion.css";

/** A focused centre slide with genuine neighbouring results; no sample results. */
export function EditorialVisualCarousel({children, labels}:{children:ReactNode[];labels:string[]}) {
  const [selected,setSelected]=useState(0);
  const touch=useRef<{x:number;y:number}|null>(null);
  const wheel=useRef(0);
  const swiped=useRef(false);
  const active=Math.min(selected,Math.max(0,children.length-1));
  const move=(offset:number)=>setSelected(Math.max(0,Math.min(children.length-1,active+offset)));
  return <div className="editorial-visual-gallery" role="region" aria-label="Просмотр слайдов">
    <div className="editorial-visual-stage" tabIndex={0} aria-label="Листайте слайды стрелками или свайпом"
      onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(event.key==="ArrowRight"||event.key==="ArrowLeft"){event.preventDefault();move(event.key==="ArrowRight"?1:-1);}}}
      onWheel={event=>{if(Math.abs(event.deltaX)<Math.abs(event.deltaY))return;const now=Date.now();if(now-wheel.current>350&&Math.abs(event.deltaX)>12){wheel.current=now;move(event.deltaX>0?1:-1);}}}
      onPointerDown={event=>{swiped.current=false;touch.current={x:event.clientX,y:event.clientY};}}
      onPointerUp={event=>{const from=touch.current;touch.current=null;if(from&&Math.abs(event.clientX-from.x)>60&&Math.abs(event.clientY-from.y)<65){swiped.current=true;move(event.clientX<from.x?1:-1);}}}
      onPointerCancel={()=>{touch.current=null;}} onClickCapture={event=>{if(swiped.current){event.preventDefault();event.stopPropagation();swiped.current=false;}}}>
      {children.map((child,index)=><div key={index} className="editorial-visual-slide" data-active={index===active} aria-hidden={index!==active} inert={index!==active} style={{"--slide-offset":Math.max(-2,Math.min(2,index-active)),opacity:Math.abs(index-active)>1?0:1,zIndex:index===active?30:10} as CSSProperties}>{child}</div>)}
    </div>
    <div className="editorial-visual-controls"><button type="button" disabled={active===0} onClick={()=>move(-1)} aria-label="Предыдущий слайд"><ChevronLeft size={20}/></button><span aria-live="polite">{active+1} / {children.length}<strong>{labels[active]}</strong></span><button type="button" disabled={active===children.length-1} onClick={()=>move(1)} aria-label="Следующий слайд"><ChevronRight size={20}/></button></div>
    <div className="editorial-visual-dots">{children.map((_,index)=><button type="button" key={index} aria-label={`Показать слайд ${index+1}`} aria-pressed={index===active} onClick={()=>setSelected(index)}/>)}</div>
  </div>;
}
