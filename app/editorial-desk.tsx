"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CalendarDays, X, PenLine, Sparkles } from "lucide-react";
import "./editorial-motion.css";

type DeskMaterial = { id:string; title:string; body:string; imageUrl?:string };
export function EditorialDesk({ material, publication, count, tools, statistics, onOpenMaterial, onPublications, onCreate, onTool }: {
  material?:DeskMaterial; publication?:{title:string;scheduledAt:string}; count:number;
  tools:{id:string;title:string;text:string;cta:string}[];
  statistics:{label:string;value:number}[];
  onOpenMaterial:()=>void; onPublications:()=>void; onCreate:()=>void; onTool:(id:string)=>void;
}) {
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toolDetails = tools.find(tool => tool.id === selectedTool);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (selectedTool && dialog && !dialog.open) dialog.showModal();
  }, [selectedTool]);
  return <div className="editorial-desk">
    <div className="editorial-desk-top"><span>Ваша редакция сегодня</span><button type="button" onClick={onCreate}><PenLine size={18}/>Новый материал</button></div>
    <div className="editorial-desk-grid">
      <button type="button" className="editorial-desk-next" onClick={onPublications}>
        <span><CalendarDays size={18}/>Ближайшая публикация<ArrowUpRight size={18}/></span>
        <strong>{publication?.title || "У каждой истории — свой день"}</strong>
        <span>{publication ? new Date(publication.scheduledAt).toLocaleString("ru-RU",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}) : "Открыть календарь"}</span>
      </button>
      <button type="button" className="editorial-desk-feature" onClick={material ? onOpenMaterial : onCreate}>
        <Image src={material?.imageUrl || "/dialogue/card-photos/architecture.jpg"} alt="" fill sizes="(max-width: 800px) 90vw, 55vw" unoptimized/>
        <span className="editorial-desk-feature-head">{material ? "Продолжить работу" : "Следующая история начинается здесь"}<ArrowUpRight size={23}/></span>
        <div><span>КЛИО / Редакционный стол</span><h2>{material?.title || "Дайте вашей идее форму."}</h2><p>{material?.body || "Создайте текст, найдите визуальный образ и подготовьте публикацию."}</p><span className="editorial-desk-feature-cta">{material ? "Открыть материал" : "Начать с идеи"}<ArrowUpRight size={18}/></span></div>
      </button>
      <div className="editorial-desk-note"><span><Sparkles size={18}/>В фокусе</span><h3>От замысла<br/>до публикации.</h3><p>Выберите следующий шаг — всё нужное уже на столе.</p><button type="button" onClick={onCreate}>Написать текст<ArrowUpRight size={22}/></button><footer><span>{count} материалов в коллекции</span><button type="button" onClick={()=>onTool("history")} aria-label="Открыть коллекцию"><ArrowUpRight size={22}/></button></footer></div>
    </div>
    <section className="editorial-desk-statistics" aria-label="Ваша статистика">
      <h3>Ваша статистика</h3>
      <dl>{statistics.map(stat=><div key={stat.label}><dd>{stat.value.toLocaleString("ru-RU")}</dd><dt>{stat.label}</dt></div>)}</dl>
    </section>
    <div className="editorial-desk-tools" aria-label="Инструменты редакции">{tools.map((tool,index)=><article key={tool.id} className="editorial-desk-tool">
      <button type="button" className="editorial-desk-tool-link" onClick={()=>setSelectedTool(tool.id)} aria-haspopup="dialog">
        <span>{String(index+1).padStart(2,"0")}</span><strong>{tool.title}</strong><ArrowUpRight size={19}/>
        <span className="editorial-desk-tool-hint">Нажмите, чтобы узнать больше</span>
      </button>
    </article>)}</div>
    <dialog ref={dialogRef} className="editorial-tool-dialog" aria-labelledby="editorial-tool-title" onClose={()=>setSelectedTool(null)} onClick={event=>{if(event.target===event.currentTarget) dialogRef.current?.close();}}>
      {toolDetails && <div className="editorial-tool-dialog-content">
        <button type="button" className="editorial-tool-close" aria-label="Закрыть описание" onClick={()=>dialogRef.current?.close()}><X size={22}/></button>
        <span className="editorial-tool-kicker">КЛИО / Инструменты редакции</span>
        <h2 id="editorial-tool-title">{toolDetails.title}</h2>
        <p>{toolDetails.text}</p>
        <button type="button" className="editorial-tool-action" onClick={()=>{dialogRef.current?.close();onTool(toolDetails.id);}}>{toolDetails.cta}<ArrowUpRight size={22}/></button>
      </div>}
    </dialog>
  </div>;
}
