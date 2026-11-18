"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import "./dialogue-calendar-morph.css";
import "./editorial-motion.css";
import { HelpTip } from "./help-tip";

export type CalendarPublication = {
  id: string; scheduledAt: string; title: string; body: string; imageUrl: string;
  status: string; retryCount: number;
  channel: { platform: "telegram" | "vk"; label: string } | null;
};
function dayKey(day: Date) {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}
function dateLabel(day: Date) { return day.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" }); }
function statusLabel(status: string) {
  return status === "published" ? "Опубликовано" : status === "failed" ? "Нужна проверка" : status === "publishing" ? "Публикуется" : "Запланировано";
}

export function DialoguePublicationCalendar<T extends CalendarPublication>({ days, cursor, items, selectedKey, view, loading, onSelect, onNavigateDay, onView, onPrevious, onNext, onToday, onEdit, onMove, onPointerStart, onPointerMove, onPointerEnd, onPointerCancel, movingDay, isClickSuppressed }: {
  days: Date[]; cursor: Date; items: T[]; selectedKey: string | null; view: "month" | "week" | "list"; loading: boolean;
  onSelect: (key: string) => void; onView: (view: "month" | "week" | "list") => void;
  onNavigateDay?: (day: Date) => void;
  onPrevious: () => void; onNext: () => void; onToday: () => void;
  onEdit: (day: Date, item?: T) => void; onMove: (item: T, day: Date) => void;
  onPointerStart?: (event: ReactPointerEvent<HTMLElement>, item: T) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerEnd?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLElement>) => void;
  movingDay?: string | null; isClickSuppressed?: () => boolean;
}) {
  const [dayOpen, setDayOpen] = useState(false);
  const [platform, setPlatform] = useState("all");
  const [dropKey, setDropKey] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x:number; y:number } | null>(null);
  const suppressDayClickUntil = useRef(0);
  const horizontalWheel = useRef({ delta:0, at:0 });
  const before = useRef<{ height: number; days: Map<string, DOMRect> } | null>(null);
  const capture = useCallback(() => {
    if (!grid.current) return;
    before.current = { height:grid.current.getBoundingClientRect().height, days:new Map([...grid.current.querySelectorAll<HTMLElement>('[data-publication-day]')].map(node => [node.dataset.publicationDay!,node.getBoundingClientRect()])) };
  }, []);
  const filtered = useMemo(() => items.filter(item => platform === "all" || item.channel?.platform === platform), [items, platform]);
  const byDay = useMemo(() => {
    const result = new Map<string, T[]>();
    for (const item of [...filtered].sort((a,b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
      const key = dayKey(new Date(item.scheduledAt));
      result.set(key, [...(result.get(key) || []), item]);
    }
    return result;
  }, [filtered]);
  const selected = selectedKey ? days.find(day => dayKey(day) === selectedKey) : undefined;
  const selectedItems = selectedKey ? byDay.get(selectedKey) || [] : [];
  const expanded = dayOpen && Boolean(selected) && view !== "list";
  const week = useMemo(() => {
    const start = new Date(selected || cursor);
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    return Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [selected, cursor]);
  const displayDays = expanded ? week : days;
  const select = useCallback((day: Date) => {
    if (!expanded) capture();
    if (!days.some(candidate => dayKey(candidate) === dayKey(day)) && onNavigateDay) onNavigateDay(day);
    else onSelect(dayKey(day));
    setDayOpen(true);
  }, [expanded,capture,days,onNavigateDay,onSelect]);
  const moveDay = useCallback((direction: number) => {
    if (!selected) return;
    select(new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()+direction));
  }, [selected,select]);
  useEffect(() => {
    const target = grid.current;
    if (!expanded || !target) return;
    const wheel = (event: WheelEvent) => {
      const delta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (!delta || (!event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY))) return;
      event.preventDefault();
      const gesture = horizontalWheel.current;
      if (Date.now()-gesture.at < 320) return;
      gesture.delta += delta * (event.deltaMode === 1 ? 16 : 1);
      if (Math.abs(gesture.delta) < 45) return;
      moveDay(gesture.delta > 0 ? 1 : -1);
      gesture.at = Date.now(); gesture.delta = 0;
    };
    target.addEventListener('wheel',wheel,{passive:false});
    return () => target.removeEventListener('wheel',wheel);
  }, [expanded,moveDay]);
  const collapse = useCallback(() => { capture(); setDayOpen(false); }, [capture]);
  useLayoutEffect(() => {
    const previous = before.current;
    before.current = null;
    const target = grid.current;
    if (!previous || !target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animations: Animation[] = [];
    const height = target.getBoundingClientRect().height;
    animations.push(target.animate([{height:`${previous.height}px`},{height:`${height}px`}], {duration:480,easing:'cubic-bezier(.22,1,.36,1)'}));
    target.querySelectorAll<HTMLElement>('[data-publication-day]').forEach(node => {
      const old = previous.days.get(node.dataset.publicationDay!);
      if (!old) return;
      const now = node.getBoundingClientRect();
      animations.push(node.animate([
        {transform:`translate(${old.left-now.left}px,${old.top-now.top}px) scale(${old.width/now.width},${old.height/now.height})`},
        {transform:'translate(0,0) scale(1,1)'}
      ],{duration:480,easing:'cubic-bezier(.22,1,.36,1)'}));
    });
    return () => animations.forEach(animation => animation.cancel());
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector('.archive-editor-overlay')) collapse(); };
    const timer = window.matchMedia('(max-width: 720px)').matches ? window.setTimeout(() => {
      root.current?.scrollIntoView({ block:'start', behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }, 490) : null;
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("keydown", close); if (timer !== null) clearTimeout(timer); };
  }, [expanded, collapse]);
  function renderPost(item: T) {
    return <button type="button" key={item.id} className={`glass-calendar-post is-${item.channel?.platform || "none"} is-${item.status}`} onClick={() => onEdit(new Date(item.scheduledAt), item)}>
      <span className="glass-calendar-post-meta"><span>{item.channel?.platform === "telegram" ? "Telegram" : item.channel?.platform === "vk" ? "ВКонтакте" : "Канал отключён"}</span><time>{new Date(item.scheduledAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time><ArrowUpRight size={16}/></span>
      {item.imageUrl && <span className="glass-calendar-post-image" style={{ backgroundImage: `url("${item.imageUrl}")` }}/>}
      <strong>{item.title || "Без названия"}</strong><span className="glass-calendar-post-excerpt">{item.body}</span>
      <span className="glass-calendar-post-foot"><span>{item.channel?.label || "Выберите канал"}</span><em>{statusLabel(item.status)}</em></span>
    </button>;
  }
  return <div ref={root} className={`glass-calendar calendar-morph${expanded ? " is-day-open" : ""}`} aria-busy={loading} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerCancel}>
    <div className="glass-calendar-controls">
      <div className="glass-calendar-period"><button type="button" aria-label="Предыдущий период" onClick={() => { setDayOpen(false); onPrevious(); }}><ChevronLeft size={18}/></button><h3>{cursor.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</h3><button type="button" aria-label="Следующий период" onClick={() => { setDayOpen(false); onNext(); }}><ChevronRight size={18}/></button><button type="button" className="glass-calendar-today" onClick={onToday}>Сегодня</button></div>
      <div className="glass-calendar-view" aria-label="Вид календаря" role="group">{([['month','Месяц'],['week','Неделя'],['list','Список']] as const).map(([value,label]) => <button type="button" key={value} aria-pressed={view === value} onClick={() => { setDayOpen(false); onView(value); }}>{label}</button>)}</div>
      <button type="button" className="glass-calendar-add" onClick={() => onEdit(selected || new Date())}><Plus size={16}/><span>Публикация</span></button>
    </div>
    <div className="glass-calendar-layout">
      <section className="glass-calendar-board" aria-label="Календарь публикаций">
        {expanded && <div className="calendar-morph-caption"><span>{selected?.toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</span><button type="button" className="calendar-morph-return" onClick={collapse}><CalendarDays size={15}/>Весь месяц</button></div>}
        <div className={`calendar-day-navigation${expanded ? " is-expanded" : ""}`}>
        {expanded && <button type="button" className="calendar-day-step" aria-label="Предыдущий день" onClick={() => moveDay(-1)}><ChevronLeft size={18}/></button>}
        {view === "list" ? <div className="glass-calendar-all-posts">{filtered.length ? filtered.map(renderPost) : <p className="glass-calendar-empty">В этом периоде пока нет публикаций.</p>}</div> : <div ref={grid} tabIndex={expanded ? 0 : undefined} aria-label={expanded ? "Дни недели. Листайте влево или вправо" : undefined} className={`glass-calendar-grid is-${view}${expanded ? " is-compact" : ""}`}
          onKeyDown={event => {
            if (!expanded || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
            event.preventDefault(); event.currentTarget.focus({preventScroll:true}); moveDay(event.key === 'ArrowRight' ? 1 : -1);
          }}
          onPointerDown={event => { if(expanded) swipe.current = {x:event.clientX,y:event.clientY}; }}
          onPointerMove={event => {
            const start=swipe.current;
            if (!expanded || !start) return;
            if (Math.abs(event.clientX-start.x)>12 && Math.abs(event.clientX-start.x)>Math.abs(event.clientY-start.y)*1.2) event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={event => {
            const start=swipe.current; swipe.current=null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            if (!expanded || !start) return;
            const dx=event.clientX-start.x,dy=event.clientY-start.y;
            if (Math.abs(dx)>45 && Math.abs(dx)>Math.abs(dy)*1.2) { suppressDayClickUntil.current=Date.now()+400; moveDay(dx<0 ? 1 : -1); }
          }} onPointerCancel={() => { swipe.current=null; }}>
          {!expanded && ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map(label => <span className="glass-calendar-weekday" key={label}>{label}</span>)}
          {displayDays.map(day => {
            const key = dayKey(day), posts = byDay.get(key) || [];
            return <button type="button" key={key} data-publication-day={key} className={`glass-calendar-day${posts.length ? " has-publications" : ""}${day.getMonth() !== cursor.getMonth() && view === "month" ? " is-outside" : ""}${key === dayKey(new Date()) ? " is-today" : ""}${key === selectedKey ? " is-selected" : ""}${(key === dropKey || key === movingDay) ? " is-drop-target" : ""}`} aria-pressed={key === selectedKey} aria-label={`${dateLabel(day)}, публикаций: ${posts.length}`} onClick={() => { if (Date.now()>suppressDayClickUntil.current && !isClickSuppressed?.()) select(day); }} onDragOver={event => { event.preventDefault(); setDropKey(key); }} onDragLeave={() => setDropKey(null)} onDrop={event => { event.preventDefault(); setDropKey(null); const item = items.find(item => item.id === event.dataTransfer.getData("text/plain")); if (item?.status === "scheduled") onMove(item, day); }}>
              <small className="calendar-morph-weekday">{day.toLocaleDateString("ru-RU",{weekday:"short"})}</small><span className="glass-calendar-day-number">{day.getDate()}</span><i className="calendar-morph-dot" style={{opacity:posts.length ? 1 : 0}}/>
              <span className="calendar-event-count" aria-label={posts.length ? `Публикаций: ${posts.length}` : undefined}>{posts.length > 0 && <><b>{posts.length}</b><span> {posts.length === 1 ? "пост" : "поста"}</span></>}</span><span className="glass-calendar-day-events">{posts.slice(0,2).map(item => <span key={item.id} title={item.title || "Публикация"} className={`glass-calendar-event is-${item.status}`} draggable={item.status === "scheduled"} onPointerDown={event => onPointerStart?.(event,item)} onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData("text/plain",item.id); event.dataTransfer.effectAllowed = "move"; }}><i/><span>{item.title || "Публикация"}</span></span>)}{posts.length>2 && <small>+{posts.length-2} ещё</small>}</span>
            </button>;
          })}
        </div>}
        {expanded && <button type="button" className="calendar-day-step" aria-label="Следующий день" onClick={() => moveDay(1)}><ChevronRight size={18}/></button>}
        </div>
        <div className="glass-calendar-filters" role="group" aria-label="Каналы публикаций">{([['all','Все каналы'],['telegram','Telegram'],['vk','ВКонтакте']] as const).map(([value,label]) => <button type="button" key={value} aria-pressed={platform === value} onClick={() => setPlatform(value)}><i/>{label}</button>)}</div>
        
      </section>
      {expanded && <section className="glass-calendar-detail" aria-label="Публикации выбранного дня" key={selectedKey || "none"}>
        <div className="glass-calendar-day-title">{selected && <button type="button" className="glass-calendar-day-add" aria-label="Добавить публикацию на выбранный день" title="Добавить публикацию" onClick={() => onEdit(selected)}><Plus size={17}/><span>Добавить публикацию</span></button>}<span>{selected?.toLocaleDateString("ru-RU", { weekday: "long" }) || "Ваш календарь"}</span><h3>{selected?.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) || "Выберите день"}</h3>{selectedItems.length > 0 && <p>{`Публикаций: ${selectedItems.length}`}</p>}</div>
        <div className="glass-calendar-day-posts">{selectedItems.length ? selectedItems.map(renderPost) : <div className="glass-calendar-empty"><CalendarDays size={28}/><strong>{selected ? "Здесь пока тихо" : "У каждой истории — свой день"}</strong><HelpTip label="Как добавить публикацию" text="Нажмите плюс или «Добавить публикацию», выберите материал, канал и время. КЛИО сохранит публикацию в календаре."/>{selected && <button type="button" onClick={() => onEdit(selected)}><Plus size={16}/>Добавить публикацию</button>}</div>}</div>
      </section>}
    </div>
  </div>;
}
