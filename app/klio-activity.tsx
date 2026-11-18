"use client";
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import "./editorial-motion.css";

export function KlioActivity(){return <span className="klio-activity" aria-hidden="true">{Array.from({length:5},(_,index)=><i key={index} style={{animationDelay:`${index*110}ms`}}/>)}</span>;}

export function KlioResponseActivity({running}:{running:boolean}) {
  const previous=useRef(running);
  const [complete,setComplete]=useState(false);
  useEffect(()=>{
    const finished=previous.current&&!running;
    previous.current=running;
    if(!finished&&!running)return;
    const show=window.setTimeout(()=>setComplete(finished),0);
    const hide=finished?window.setTimeout(()=>setComplete(false),1100):null;
    return ()=>{window.clearTimeout(show);if(hide!==null)window.clearTimeout(hide);};
  },[running]);
  if(!running&&!complete)return null;
  return <div className={`klio-aui-status${!running?" is-complete":""}`} role="status">{running?<KlioActivity/>:<span className="klio-activity-check"><Check size={18}/></span>}{running?"Готовлю ответ…":"Готово"}</div>;
}
