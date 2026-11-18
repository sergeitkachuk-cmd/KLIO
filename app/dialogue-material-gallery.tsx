"use client";

import { Children, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import { ArrowUpRight, Search, X, ChevronLeft, ChevronRight, Layers, LayoutGrid } from "lucide-react";
import { DialogueModal } from "./dialogue-modal";
import "./dialogue-material-bento.css";
import "./editorial-motion.css";

type MaterialCover = { id: string; title: string; label: string; date: string; body: string; imageUrl?: string };

/** Each tile owns one material; opening it never changes another tile. */
export function DialogueMaterialGallery({ enabled, items, children, className }: {
  enabled: boolean; items: MaterialCover[]; children: ReactNode; className: string;
}) {
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view,setView] = useState<"grid"|"stack">("grid");
  const [position,setPosition] = useState(0);
  const positionNow = useRef(0);
  const target = useRef(0);
  const motion = useRef<number | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRect = useRef<DOMRect|null>(null);
  const touch = useRef<{x:number;y:number;position:number}|null>(null);
  const suppressClick = useRef(false);
  const stack = useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    if(!openedId || !sourceRect.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const panel=document.querySelector<HTMLElement>(".klio-chatkit-thread-dialog:has(.material-bento-detail)");
    if(!panel)return;
    const from=sourceRect.current,to=panel.getBoundingClientRect();
    const animation=panel.animate([{transform:`translate(${from.x+from.width/2-to.x-to.width/2}px,${from.y+from.height/2-to.y-to.height/2}px) scale(${Math.min(.8,from.width/to.width)})`,opacity:.25},{transform:"translate(0,0) scale(1)",opacity:1}],{duration:380,easing:"cubic-bezier(.22,1,.36,1)"});
    return ()=>animation.cancel();
  },[openedId]);
  const cards = Children.toArray(children);
  const search = query.trim().toLocaleLowerCase("ru-RU");
  const filtered = items.filter(item => !search || `${item.title} ${item.label} ${item.body}`.toLocaleLowerCase("ru-RU").includes(search));
  const active=Math.max(0,Math.min(Math.round(position),filtered.length-1));
  const travelTo=(next:number)=>{
    target.current=Math.max(0,Math.min(Math.max(0,filtered.length-1),next));
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){
      positionNow.current=target.current;setPosition(target.current);return;
    }
    if(motion.current!==null)return;
    let last=performance.now();
    const frame=(now:number)=>{
      const dt=Math.min(40,now-last);last=now;
      const difference=target.current-positionNow.current;
      positionNow.current+=difference*(1-Math.exp(-dt/85));
      if(Math.abs(difference)<.001){positionNow.current=target.current;motion.current=null;}
      else motion.current=requestAnimationFrame(frame);
      setPosition(positionNow.current);
    };
    motion.current=requestAnimationFrame(frame);
  };
  const move=(offset:number)=>travelTo(Math.round(target.current)+offset);
  const resetStack=()=>{target.current=0;positionNow.current=0;setPosition(0);};
  useEffect(()=>()=>{
    if(motion.current!==null)cancelAnimationFrame(motion.current);
    if(snapTimer.current)clearTimeout(snapTimer.current);
  },[]);
  useEffect(()=>{
    const node=stack.current;
    if(view!=="stack"||!node)return;
    const onWheel=(event:WheelEvent)=>{
      const raw=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
      const delta=raw*(event.deltaMode===1?16:event.deltaMode===2?node.clientHeight:1);
      if(!delta)return;
      const end=Math.max(0,filtered.length-1);
      if((delta>0&&target.current>=end)||(delta<0&&target.current<=0))return;
      event.preventDefault();
      travelTo(target.current+Math.max(-140,Math.min(140,delta))/180);
      if(snapTimer.current)clearTimeout(snapTimer.current);
      snapTimer.current=setTimeout(()=>travelTo(Math.round(target.current)),160);
    };
    node.addEventListener("wheel",onWheel,{passive:false});
    return ()=>{node.removeEventListener("wheel",onWheel);if(snapTimer.current)clearTimeout(snapTimer.current);};
    // travelTo reads motion refs; only the collection length changes its bounds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[view,filtered.length]);
  const openedIndex = items.findIndex(item => item.id === openedId);
  const opened = items[openedIndex];

  if (!enabled) return <div className={className}>{children}</div>;

  return <div className={`material-bento editorial-materials is-${view}`}>
    <div className="material-bento-bar">
      <span className="material-bento-brand">КЛИО / КОЛЛЕКЦИЯ</span>
      <label className="material-bento-search"><Search size={16}/><input type="search" value={query} onChange={event => { setQuery(event.target.value); resetStack(); }} placeholder="Найти в материалах" aria-label="Найти в материалах"/>{query && <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск"><X size={15}/></button>}</label>
      <div className="editorial-view-switch" aria-label="Вид коллекции"><button type="button" aria-label="Плитки" aria-pressed={view==="grid"} onClick={()=>setView("grid")}><LayoutGrid size={17}/><span>Плитки</span></button><button type="button" aria-label="Стопка" aria-pressed={view==="stack"} onClick={()=>setView("stack")}><Layers size={17}/><span>Стопка</span></button></div>
      <span className="material-bento-total">{filtered.length} <span>в коллекции</span></span>
    </div>
    {filtered.length ? <div className={`material-bento-cards count-${Math.min(filtered.length,3)}`} aria-label="Материалы коллекции" ref={stack} tabIndex={view==="stack"?0:undefined}
      onKeyDown={event=>{if(view!=="stack"||event.target!==event.currentTarget)return;if(["ArrowDown","ArrowRight","ArrowUp","ArrowLeft"].includes(event.key)){event.preventDefault();move(["ArrowDown","ArrowRight"].includes(event.key)?1:-1);}}}
      onPointerDown={event=>{if(view!=="stack"||event.button!==0)return;touch.current={x:event.clientX,y:event.clientY,position:target.current};suppressClick.current=false;if(snapTimer.current)clearTimeout(snapTimer.current);}}
      onPointerMove={event=>{const from=touch.current;if(view!=="stack"||!from)return;const delta=event.clientY-from.y;if(Math.abs(delta)>6)suppressClick.current=true;if(suppressClick.current){event.currentTarget.setPointerCapture(event.pointerId);travelTo(from.position-delta/175);}}}
      onPointerUp={event=>{if(!touch.current)return;touch.current=null;if(view==="stack"&&suppressClick.current){travelTo(Math.round(target.current));if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}}
      onPointerCancel={()=>{touch.current=null;travelTo(Math.round(target.current));}}>
      {filtered.map((item,index) => <button type="button" key={item.id} data-material-id={item.id}
        style={view==="stack"?{"--ribbon-offset":index-position,"--ribbon-blur":`${Math.max(0,Math.abs(index-position)-.65)*2.2}px`,"--ribbon-tone":index%3,"--ribbon-x":`${Math.sin((index-position)*.72)*70}px`,"--ribbon-angle":`${Math.sin((index-position)*.72)*-13}deg`,"--ribbon-scale":Math.max(.72,1-Math.abs(index-position)*.065),zIndex:50-Math.round(Math.abs(index-position)*10),opacity:Math.max(0,Math.min(1,3.5-Math.abs(index-position)))} as CSSProperties:undefined} tabIndex={view==="stack"&&index!==active?-1:0} inert={view==="stack"&&Math.abs(index-active)>3} data-stack-active={view==="stack"&&index===active}
        className={`material-bento-tile tile-${index === 0 ? "feature" : index === 1 ? "preview" : "compact"}${item.imageUrl ? " has-image" : ""}`}
        aria-label={`Открыть материал: ${item.title}`} aria-haspopup="dialog" onClick={event => {if(suppressClick.current){suppressClick.current=false;return;}if(view==="stack"&&index!==active){travelTo(index);return;}sourceRect.current=event.currentTarget.getBoundingClientRect();setOpenedId(item.id);}}>
        {item.imageUrl && <Image src={item.imageUrl} alt="" fill sizes="(max-width: 700px) 90vw, 45vw" unoptimized/>}
        <span className="material-bento-tile-meta"><span>{item.label}</span><span>{item.date}</span></span>
        <strong>{item.title}</strong>
        <span className="material-bento-tile-excerpt">{item.body.replace(/\s+/g," ")}</span>
        <span className="material-bento-tile-bottom"><span>Открыть материал</span><i><ArrowUpRight size={19}/></i></span>
      </button>)}
    </div> : <div className="material-bento-empty"><Search size={25}/><h3>Ничего не найдено</h3><p>Попробуйте другое слово или название материала.</p><button type="button" onClick={() => setQuery("")}>Показать всю коллекцию</button></div>}
    {view==="stack"&&filtered.length>0&&<div className="editorial-stack-controls"><button type="button" aria-label="Предыдущий материал" disabled={active===0} onClick={()=>move(-1)}><ChevronLeft size={20}/></button><span aria-live="polite">{active+1} / {filtered.length}<small>Листайте колесом или свайпом</small></span><button type="button" aria-label="Следующий материал" disabled={active===filtered.length-1} onClick={()=>move(1)}><ChevronRight size={20}/></button></div>}
    {opened && <DialogueModal title={opened.title} onClose={() => setOpenedId(null)}>
      <div className="material-bento-detail workspace-history-list" onClickCapture={event => {
        // Hand over focus when an existing action opens an editor or another view.
        const target = event.target;
        if (target instanceof Element && target.closest('footer button:not(.material-delete):not(.material-archive):not(.material-export), .image-generator-result-trigger, .material-plan-send')) setOpenedId(null);
      }}>{cards[openedIndex]}</div>
    </DialogueModal>}
  </div>;
}
